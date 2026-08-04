/**
 * zkCoins Bundle Encryption (ZBE) — §4.2.1.
 *
 * Chunked ChaCha20-Poly1305 with index-binding AAD. Built in the explorer
 * because @zkcoins/sdk does not yet expose ZBE. Primitive: @noble/ciphers
 * (ChaCha20-Poly1305 is not a reliable WebCrypto AEAD across browsers).
 *
 * Wire:
 *   ciphertext = "ZBE1" ‖ u32_be(N) ‖ Σ (u32_be(len C_i) ‖ C_i)
 *   nonce_i    = 0x00000000 ‖ u64_be(i)          // 12 bytes
 *   aad_i      = "zkCoins/v1/Blob" ‖ u32_be(N) ‖ u32_be(i)
 *   kb         = HKDF("zkCoins/v1/BlobKey", K_tx)
 *   blob_id    = SHA-256(ciphertext)
 *
 * Any auth/framing failure aborts the whole open — never a partial plaintext.
 */

import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { deriveBlobKey } from '@/lib/crypto/hkdf';
import { sha256 } from '@/lib/crypto/sha256';
import { writeU32Be } from '@/lib/crypto/bytes';

export const ZBE_MAGIC = new TextEncoder().encode('ZBE1');
export const ZBE_CHUNK = 65_536;
export const ZBE_TAG_LEN = 16;
export const ZBE_AAD_PREFIX = new TextEncoder().encode('zkCoins/v1/Blob');

export type ZbeErrorCode =
  | 'wrong_magic'
  | 'truncated'
  | 'invalid_chunk_count'
  | 'chunk_count_mismatch'
  | 'chunk_length_overrun'
  | 'chunk_too_short'
  | 'trailing_bytes'
  | 'auth_failed'
  | 'too_many_chunks'
  | 'bad_key_length';

export class ZbeError extends Error {
  readonly code: ZbeErrorCode;
  readonly chunkIndex?: number;

  constructor(code: ZbeErrorCode, message: string, chunkIndex?: number) {
    super(message);
    this.name = 'ZbeError';
    this.code = code;
    if (chunkIndex !== undefined) {
      this.chunkIndex = chunkIndex;
    }
  }
}

function requireKey32(kTx: Uint8Array): void {
  if (!(kTx instanceof Uint8Array) || kTx.length !== 32) {
    throw new ZbeError(
      'bad_key_length',
      `ZBE K_tx must be 32 bytes, got ${kTx instanceof Uint8Array ? kTx.length : typeof kTx}`,
    );
  }
}

function chunkCount(plaintextLen: number): number {
  if (plaintextLen === 0) {
    return 1;
  }
  const n = Math.ceil(plaintextLen / ZBE_CHUNK);
  /* v8 ignore next 3 -- a plaintext needing >u32 chunks is not constructible in-process */
  if (n > 0xffffffff) {
    throw new ZbeError('too_many_chunks', `ZBE plaintext requires ${n} chunks (exceeds u32::MAX)`);
  }
  return n;
}

/** `nonce_i = 0x00000000 ‖ u64_be(i)` — 12 bytes. */
export function zbeNonce(i: number): Uint8Array {
  if (!Number.isInteger(i) || i < 0 || i > 0xffffffff) {
    throw new Error(`zbeNonce: i out of u32 range: ${i}`);
  }
  const nonce = new Uint8Array(12);
  // bytes 0..3 already zero
  const counter = BigInt(i);
  for (let b = 0; b < 8; b++) {
    nonce[11 - b] = Number((counter >> BigInt(8 * b)) & 0xffn);
  }
  return nonce;
}

/** `aad_i = "zkCoins/v1/Blob" ‖ u32_be(N) ‖ u32_be(i)`. */
export function zbeAad(n: number, i: number): Uint8Array {
  const aad = new Uint8Array(ZBE_AAD_PREFIX.length + 8);
  aad.set(ZBE_AAD_PREFIX, 0);
  aad.set(writeU32Be(n), ZBE_AAD_PREFIX.length);
  aad.set(writeU32Be(i), ZBE_AAD_PREFIX.length + 4);
  return aad;
}

export interface ZbeSealResult {
  ciphertext: Uint8Array;
  blobId: Uint8Array;
}

/**
 * Seal plaintext under K_tx. Deterministic: same (K_tx, P) ⇒ same ciphertext.
 * Exported for fixtures/tests; production confirmation links only open.
 */
export function zbeSeal(kTx: Uint8Array, plaintext: Uint8Array): ZbeSealResult {
  requireKey32(kTx);
  if (!(plaintext instanceof Uint8Array)) {
    throw new Error('zbeSeal: plaintext must be a Uint8Array');
  }
  const n = chunkCount(plaintext.length);
  const kb = deriveBlobKey(kTx);

  const parts: Uint8Array[] = [ZBE_MAGIC, writeU32Be(n)];
  let total = 8;
  for (let i = 0; i < n; i++) {
    const start = i * ZBE_CHUNK;
    const end = Math.min(start + ZBE_CHUNK, plaintext.length);
    const p_i = plaintext.subarray(start, end);
    const nonce = zbeNonce(i);
    const aad = zbeAad(n, i);
    // @noble/ciphers: create cipher with key+nonce, AAD via .encrypt/.decrypt options
    // chacha20poly1305(key, nonce) returns { encrypt, decrypt }; AAD is 3rd ctor arg in v1.
    const cipher = chacha20poly1305(kb, nonce, aad);
    const c_i = cipher.encrypt(p_i);
    parts.push(writeU32Be(c_i.length));
    parts.push(c_i);
    total += 4 + c_i.length;
  }

  const ciphertext = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    ciphertext.set(p, offset);
    offset += p.length;
  }
  return { ciphertext, blobId: sha256(ciphertext) };
}

/**
 * Open a ZBE ciphertext under K_tx.
 * Fail-closed on every framing/auth error; never returns partial plaintext.
 */
export function zbeOpen(kTx: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  requireKey32(kTx);
  if (!(ciphertext instanceof Uint8Array)) {
    throw new Error('zbeOpen: ciphertext must be a Uint8Array');
  }

  // --- Phase 1: pure framing parse (no AEAD) ---
  if (ciphertext.length < 8) {
    throw new ZbeError('truncated', 'ZBE ciphertext truncated before complete framing');
  }
  if (
    ciphertext[0] !== ZBE_MAGIC[0] ||
    ciphertext[1] !== ZBE_MAGIC[1] ||
    ciphertext[2] !== ZBE_MAGIC[2] ||
    ciphertext[3] !== ZBE_MAGIC[3]
  ) {
    throw new ZbeError('wrong_magic', 'ZBE ciphertext missing magic "ZBE1"');
  }
  const n =
    ((ciphertext[4]! << 24) | (ciphertext[5]! << 16) | (ciphertext[6]! << 8) | ciphertext[7]!) >>>
    0;
  if (n === 0) {
    throw new ZbeError('invalid_chunk_count', 'ZBE invalid chunk count N=0 (must be >= 1)');
  }

  let offset = 8;
  const sealedChunks: Uint8Array[] = [];
  for (let i = 0; i < n; i++) {
    if (ciphertext.length < offset + 4) {
      throw new ZbeError(
        'chunk_count_mismatch',
        `ZBE chunk count mismatch: declared N=${n}, parsed ${i}`,
        i,
      );
    }
    const len =
      ((ciphertext[offset]! << 24) |
        (ciphertext[offset + 1]! << 16) |
        (ciphertext[offset + 2]! << 8) |
        ciphertext[offset + 3]!) >>>
      0;
    offset += 4;
    const remaining = ciphertext.length - offset;
    if (len > remaining) {
      throw new ZbeError(
        'chunk_length_overrun',
        `ZBE chunk ${i} length ${len} exceeds remaining ${remaining} bytes`,
        i,
      );
    }
    if (len < ZBE_TAG_LEN) {
      throw new ZbeError(
        'chunk_too_short',
        `ZBE chunk ${i} length ${len} is shorter than Poly1305 tag (16)`,
        i,
      );
    }
    sealedChunks.push(ciphertext.subarray(offset, offset + len));
    offset += len;
  }
  if (offset !== ciphertext.length) {
    throw new ZbeError(
      'trailing_bytes',
      `ZBE trailing bytes after last chunk: ${ciphertext.length - offset}`,
    );
  }

  // --- Phase 2: authenticate every chunk; only then assemble plaintext ---
  const kb = deriveBlobKey(kTx);
  const plainChunks: Uint8Array[] = [];
  for (let i = 0; i < sealedChunks.length; i++) {
    const c_i = sealedChunks[i]!;
    const nonce = zbeNonce(i);
    const aad = zbeAad(n, i);
    try {
      const cipher = chacha20poly1305(kb, nonce, aad);
      plainChunks.push(cipher.decrypt(c_i));
    } catch {
      throw new ZbeError('auth_failed', `ZBE Poly1305 authentication failed for chunk ${i}`, i);
    }
  }

  let plainLen = 0;
  for (const p of plainChunks) {
    plainLen += p.length;
  }
  const plaintext = new Uint8Array(plainLen);
  let pOff = 0;
  for (const p of plainChunks) {
    plaintext.set(p, pOff);
    pOff += p.length;
  }
  return plaintext;
}

/** Content-address check: blob_id MUST equal SHA-256(ciphertext). */
export function verifyBlobId(ciphertext: Uint8Array, expectedBlobId: Uint8Array): boolean {
  if (expectedBlobId.length !== 32) {
    throw new Error(`verifyBlobId: expectedBlobId must be 32 bytes, got ${expectedBlobId.length}`);
  }
  const actual = sha256(ciphertext);
  /* v8 ignore next 3 -- SHA-256 always returns 32 bytes; this guard is defensive only */
  if (actual.length !== 32) {
    throw new Error('verifyBlobId: SHA-256 produced non-32-byte digest');
  }
  let diff = 0;
  for (let i = 0; i < 32; i++) {
    diff |= actual[i]! ^ expectedBlobId[i]!;
  }
  return diff === 0;
}
