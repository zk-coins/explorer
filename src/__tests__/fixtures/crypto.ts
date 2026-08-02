/**
 * Shared crypto fixtures for explorer unit tests.
 * Curve points must lift under BIP-340; digests must be Goldilocks-canonical.
 */

import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type { CoinProof } from '@/lib/bundle/coinProof';

/** Deterministic non-zero fill with small bytes (canonical digest limbs). */
export function fill(n: number, v: number): Uint8Array {
  const byte = v & 0x7f; // keep limbs well below Goldilocks p
  return Uint8Array.from({ length: n }, () => byte);
}

/** Valid secp256k1 scalar in [1, n) for ECDH / point tests. */
export function validScalar(seed: number): Uint8Array {
  const s = fill(32, seed);
  s[0] = 0x01;
  return s;
}

/** X-only pubkey = x(seed·G). */
export function xOnlyFromSeed(seed: number): Uint8Array {
  const s = validScalar(seed);
  let n = 0n;
  for (const b of s) n = (n << 8n) | BigInt(b);
  const point = schnorr.Point.BASE.multiply(n);
  return point.toBytes(true).slice(1);
}

/**
 * Canonical Poseidon-digest bytes (SHA-256 of a label with each Goldilocks
 * limb forced < 2^63 so digestFromBytes accepts them).
 */
export function digestLabel(label: string): Uint8Array {
  const h = sha256(new TextEncoder().encode(label));
  for (let i = 0; i < 4; i++) {
    h[i * 8]! &= 0x7f;
  }
  return h;
}

export function sampleCoinProof(seed: number, overrides: Partial<CoinProof> = {}): CoinProof {
  const base: CoinProof = {
    coin: {
      identifier: digestLabel(`id/${seed}`),
      recipient: digestLabel(`recipient/${seed}`),
      amount: 1_000_000n + BigInt(seed),
      assetId: digestLabel(`asset/${seed}`),
    },
    proof: fill(64, seed + 3),
    inclusionProof: fill(32, seed + 4),
    creatingPrevAsh: digestLabel(`prev_ash/${seed}`),
    creatingNullifier: {
      pkCreate: xOnlyFromSeed(seed + 6),
      rCreate: xOnlyFromSeed(seed + 7),
      rPrimeCreate: fill(32, seed + 8),
    },
    navOpening: {
      size: 42n,
      mth: digestLabel(`mth/${seed}`),
      navRand: fill(32, seed + 10),
    },
    epk: xOnlyFromSeed(seed + 11),
    ciphertext: fill(48, seed + 12),
    detectTag: digestLabel(`detect/${seed}`),
  };
  return { ...base, ...overrides, coin: { ...base.coin, ...(overrides.coin ?? {}) } };
}
