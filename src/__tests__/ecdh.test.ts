/**
 * BIP-340 x-only ECDH fail-closed arms.
 */

import { describe, expect, it } from 'vitest';
import { EcdhError, ecdhSharedX, sharedSecretReceiver } from '@/lib/crypto/ecdh';
import { validScalar, xOnlyFromSeed } from './fixtures/crypto';

describe('ecdhSharedX', () => {
  it('roundtrips a valid scalar · peer x-only', () => {
    const scalar = validScalar(7);
    const peer = xOnlyFromSeed(8);
    const ss = ecdhSharedX(scalar, peer);
    expect(ss.length).toBe(32);
    expect(sharedSecretReceiver(scalar, peer)).toEqual(ss);
  });

  it('rejects wrong-length scalar and peer', () => {
    expect(() => ecdhSharedX(new Uint8Array(16), xOnlyFromSeed(1))).toThrow(EcdhError);
    expect(() => ecdhSharedX(validScalar(1), new Uint8Array(16))).toThrow(EcdhError);
    expect(() => ecdhSharedX('x' as unknown as Uint8Array, xOnlyFromSeed(1))).toThrow(EcdhError);
    expect(() => ecdhSharedX(validScalar(1), 'x' as unknown as Uint8Array)).toThrow(
      /got string/,
    );
  });

  it('rejects scalar out of range and non-quadratic-residue peer', () => {
    expect(() => ecdhSharedX(new Uint8Array(32), xOnlyFromSeed(1))).toThrow(/not in \[1, n\)/);
    const geN = new Uint8Array(32);
    geN.fill(0xff);
    expect(() => ecdhSharedX(geN, xOnlyFromSeed(1))).toThrow(/not in \[1, n\)/);
    // All-zero x-only does not lift.
    expect(() => ecdhSharedX(validScalar(1), new Uint8Array(32))).toThrow(
      /not a valid curve point/,
    );
  });
});
