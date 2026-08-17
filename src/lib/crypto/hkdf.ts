/**
 * HKDF-SHA-256 per §1.1 fixed mapping.
 *
 * HKDF(tag, material) = HKDF-Expand(
 *   HKDF-Extract(salt = 0x00×32, IKM = material),
 *   info = tag,
 *   L = 32
 * )
 */

import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

const ZERO_SALT = new Uint8Array(32);

/** `kb = HKDF("zkCoins/v1/BlobKey", K_tx)` — ZBE AEAD key (§4.2.1 step 1). */
export const TAG_BLOB_KEY = 'zkCoins/v1/BlobKey';

/** `K_tx = HKDF("zkCoins/v1/NoteKey", ss ‖ epk)` (§1.3). */
export const TAG_NOTE_KEY = 'zkCoins/v1/NoteKey';

/** `K_out = HKDF("zkCoins/v1/OutKey", ovk ‖ epk)` (§1.3). */
export const TAG_OUT_KEY = 'zkCoins/v1/OutKey';

/**
 * Spec-mapped HKDF-SHA-256: salt = 32 zero bytes, info = UTF-8(tag), L = 32.
 * Throws if material is empty (no silent default material).
 */
export function hkdfSha256(tag: string, material: Uint8Array): Uint8Array {
  if (typeof tag !== 'string' || tag.length === 0) {
    throw new Error('hkdfSha256: tag is required');
  }
  if (!(material instanceof Uint8Array) || material.length === 0) {
    throw new Error('hkdfSha256: material must be a non-empty Uint8Array');
  }
  const info = new TextEncoder().encode(tag);
  return hkdf(sha256, material, ZERO_SALT, info, 32);
}

export function deriveBlobKey(kTx: Uint8Array): Uint8Array {
  if (kTx.length !== 32) {
    throw new Error(`deriveBlobKey: K_tx must be 32 bytes, got ${kTx.length}`);
  }
  return hkdfSha256(TAG_BLOB_KEY, kTx);
}

export function deriveNoteKey(ss: Uint8Array, epk: Uint8Array): Uint8Array {
  if (ss.length !== 32) {
    throw new Error(`deriveNoteKey: ss must be 32 bytes, got ${ss.length}`);
  }
  if (epk.length !== 32) {
    throw new Error(`deriveNoteKey: epk must be 32 bytes, got ${epk.length}`);
  }
  const material = new Uint8Array(64);
  material.set(ss, 0);
  material.set(epk, 32);
  return hkdfSha256(TAG_NOTE_KEY, material);
}

export function deriveOutKey(ovk: Uint8Array, epk: Uint8Array): Uint8Array {
  if (ovk.length !== 32) {
    throw new Error(`deriveOutKey: ovk must be 32 bytes, got ${ovk.length}`);
  }
  if (epk.length !== 32) {
    throw new Error(`deriveOutKey: epk must be 32 bytes, got ${epk.length}`);
  }
  const material = new Uint8Array(64);
  material.set(ovk, 0);
  material.set(epk, 32);
  return hkdfSha256(TAG_OUT_KEY, material);
}
