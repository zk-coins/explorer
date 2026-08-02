/**
 * Independent known-answer vectors for HKDF / ZBE framing.
 *
 * These do not round-trip seal→open through the same helpers alone: expected
 * intermediate bytes are pinned so a mutually-wrong HKDF/nonce/AAD mapping
 * cannot stay green.
 */

import { describe, expect, it } from 'vitest';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import {
  deriveBlobKey,
  deriveNoteKey,
  hkdfSha256,
  TAG_BLOB_KEY,
  TAG_NOTE_KEY,
} from '@/lib/crypto/hkdf';
import { encodeHexLower } from '@/lib/crypto/bytes';
import { zbeAad, zbeNonce, zbeOpen, zbeSeal, ZBE_MAGIC } from '@/lib/crypto/zbe';

const ZERO_SALT = new Uint8Array(32);

/** Independent HKDF via noble — not the explorer wrapper under test. */
function nobleHkdf(tag: string, material: Uint8Array): Uint8Array {
  return hkdf(nobleSha256, material, ZERO_SALT, new TextEncoder().encode(tag), 32);
}

describe('HKDF known-answer vectors', () => {
  const kTx = Uint8Array.from({ length: 32 }, (_, i) => (i + 1) & 0xff);

  it('BlobKey matches independent noble HKDF and a hard hex pin', () => {
    const expected = nobleHkdf(TAG_BLOB_KEY, kTx);
    expect(deriveBlobKey(kTx)).toEqual(expected);
    expect(hkdfSha256(TAG_BLOB_KEY, kTx)).toEqual(expected);
    // Hard pin (salt=0×32, info=UTF-8("zkCoins/v1/BlobKey"), L=32, IKM=01..20):
    // catches mutual bugs if noble call sites drift together.
    expect(encodeHexLower(deriveBlobKey(kTx))).toBe(
      '4502755bf5990f6056ddb5a523676f8925491fa888e057a762c77084a398fe39',
    );
  });

  it('NoteKey material is ss‖epk under the NoteKey tag (hard pin)', () => {
    const ss = Uint8Array.from({ length: 32 }, (_, i) => (i * 3 + 1) & 0xff);
    const epk = Uint8Array.from({ length: 32 }, (_, i) => (i * 5 + 7) & 0xff);
    const material = new Uint8Array(64);
    material.set(ss, 0);
    material.set(epk, 32);
    const expected = nobleHkdf(TAG_NOTE_KEY, material);
    expect(deriveNoteKey(ss, epk)).toEqual(expected);
    expect(encodeHexLower(deriveNoteKey(ss, epk))).toBe(
      '71f59869be4a6fa31732c4caee5f142a8bbac17f126fe78affebc19909c8fe33',
    );
  });
});

describe('ZBE nonce / AAD / seal known answers', () => {
  it('nonce_i and aad_i match the fixed byte layout', () => {
    // nonce_0 = 12 zero bytes; nonce_1 = 0x00×4 ‖ u64be(1)
    expect(encodeHexLower(zbeNonce(0))).toBe('000000000000000000000000');
    expect(encodeHexLower(zbeNonce(1))).toBe('000000000000000000000001');
    // 12 bytes: 0x00000000 ‖ u64be(0x01020304)
    expect(encodeHexLower(zbeNonce(0x01020304))).toBe('000000000000000001020304');

    // aad = "zkCoins/v1/Blob" ‖ u32be(N) ‖ u32be(i)
    const aad = zbeAad(2, 1);
    const prefix = new TextEncoder().encode('zkCoins/v1/Blob');
    expect(aad.slice(0, prefix.length)).toEqual(prefix);
    expect(encodeHexLower(aad.slice(prefix.length))).toBe('0000000200000001');
  });

  it('seal matches independent ChaCha20-Poly1305 under the same kb/nonce/aad', () => {
    const kTx = Uint8Array.from({ length: 32 }, (_, i) => (0xa0 + i) & 0xff);
    const plaintext = new TextEncoder().encode('kat-plaintext-v1');
    const { ciphertext, blobId } = zbeSeal(kTx, plaintext);

    // Framing: ZBE1 ‖ u32be(1) ‖ u32be(len) ‖ C0
    expect(ciphertext.slice(0, 4)).toEqual(ZBE_MAGIC);
    expect(ciphertext[4]).toBe(0);
    expect(ciphertext[5]).toBe(0);
    expect(ciphertext[6]).toBe(0);
    expect(ciphertext[7]).toBe(1);

    const kb = nobleHkdf('zkCoins/v1/BlobKey', kTx);
    const nonce = new Uint8Array(12); // i=0
    const aad = new Uint8Array([
      ...new TextEncoder().encode('zkCoins/v1/Blob'),
      0,
      0,
      0,
      1, // N=1
      0,
      0,
      0,
      0, // i=0
    ]);
    const independent = chacha20poly1305(kb, nonce, aad).encrypt(plaintext);
    const len =
      ((ciphertext[8]! << 24) |
        (ciphertext[9]! << 16) |
        (ciphertext[10]! << 8) |
        ciphertext[11]!) >>>
      0;
    expect(len).toBe(independent.length);
    expect(ciphertext.slice(12, 12 + len)).toEqual(independent);
    expect(blobId).toEqual(nobleSha256(ciphertext));
    expect(zbeOpen(kTx, ciphertext)).toEqual(plaintext);
  });
});
