/**
 * CoinProof semantic validation: digests, curve points, asset_id recompute.
 */

import { describe, expect, it } from 'vitest';
import { assetIdV1, digestToBytes, GENESIS_TAG } from '@zkcoins/sdk';
import {
  assertAssetIdMatchesTerms,
  deserializeCoinProof,
  serializeCoinProof,
  type IssuanceTerms,
} from '@/lib/bundle/coinProof';
import { sha256 } from '@/lib/crypto/sha256';
import { digestLabel, sampleCoinProof, xOnlyFromSeed } from './fixtures/crypto';

describe('CoinProof semantic validation', () => {
  it('accepts a width+semantic valid proof without asset_terms', () => {
    const cp = sampleCoinProof(1);
    const bytes = serializeCoinProof(cp);
    const again = deserializeCoinProof(bytes);
    expect(again.coin.amount).toBe(cp.coin.amount);
  });

  it('rejects invalid x-only creating Pk', () => {
    const cp = sampleCoinProof(2);
    cp.creatingNullifier.pkCreate = new Uint8Array(32); // invalid point
    const bytes = serializeCoinProof(cp);
    expect(() => deserializeCoinProof(bytes)).toThrow(/creating_nullifier\.Pk/);
  });

  it('rejects non-canonical Poseidon digest limbs', () => {
    const cp = sampleCoinProof(3);
    // Force a limb ≥ Goldilocks p (all 0xff).
    cp.coin.identifier = new Uint8Array(32).fill(0xff);
    const bytes = serializeCoinProof(cp);
    expect(() => deserializeCoinProof(bytes)).toThrow(/non-canonical digest/);
  });

  it('recomputes asset_id from asset_terms and rejects mismatch', () => {
    const creator = xOnlyFromSeed(20);
    const name = new TextEncoder().encode('USD-Demo');
    const nameHash = sha256(name);
    const decimals = 2;
    const issuanceVersion = 1;
    const assetId = digestToBytes(
      assetIdV1(GENESIS_TAG, creator, nameHash, decimals, issuanceVersion),
    );
    const terms: IssuanceTerms = {
      creatorPubkey: creator,
      decimals,
      issuanceVersion,
      name,
    };
    const cp = sampleCoinProof(4, {
      coin: {
        identifier: digestLabel('id/terms'),
        recipient: digestLabel('recipient/terms'),
        amount: 10n,
        assetId,
      },
      assetTerms: terms,
    });
    assertAssetIdMatchesTerms(cp.coin, terms);
    const bytes = serializeCoinProof(cp);
    expect(deserializeCoinProof(bytes).assetTerms?.name).toEqual(name);

    // Mismatch: wrong name.
    const bad = sampleCoinProof(5, {
      coin: {
        identifier: digestLabel('id/bad'),
        recipient: digestLabel('recipient/bad'),
        amount: 10n,
        assetId,
      },
      assetTerms: {
        ...terms,
        name: new TextEncoder().encode('EUR-Demo'),
      },
    });
    expect(() => deserializeCoinProof(serializeCoinProof(bad))).toThrow(/asset_id/);
  });
});
