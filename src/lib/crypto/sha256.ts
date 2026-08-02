/**
 * SHA-256 (H) for content-address checks — blob_id = H(ciphertext) (§4.2.1 / §7.4).
 */

import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';

export function sha256(data: Uint8Array): Uint8Array {
  return nobleSha256(data);
}
