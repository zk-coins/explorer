/**
 * CoinProof semantic validation: digests, curve points, asset_id recompute.
 */

import { describe, expect, it } from 'vitest';
import { assetIdV1, assetIdV2, digestToBytes, GENESIS_TAG } from '@zkcoins/sdk';
import {
  assertAssetIdMatchesTerms,
  COIN_WIRE_LEN,
  deserializeCoin,
  deserializeCoinProof,
  serializeCoin,
  serializeCoinProof,
  type IssuanceTerms,
} from '@/lib/bundle/coinProof';
import { writeU32Be, writeU64Be } from '@/lib/crypto/bytes';
import { sha256 } from '@/lib/crypto/sha256';
import { digestLabel, fill, sampleCoinProof, xOnlyFromSeed } from './fixtures/crypto';

function concatParts(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

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

  it('rejects non-canonical Poseidon digest limbs at each requireCanonicalDigest site', () => {
    const bad = new Uint8Array(32).fill(0xff);
    for (const field of ['identifier', 'assetId', 'creatingPrevAsh', 'mth', 'detectTag'] as const) {
      const cp = sampleCoinProof(3);
      if (field === 'identifier') cp.coin.identifier = bad;
      if (field === 'assetId') cp.coin.assetId = bad;
      if (field === 'creatingPrevAsh') cp.creatingPrevAsh = bad;
      if (field === 'mth') cp.navOpening.mth = bad;
      if (field === 'detectTag') cp.detectTag = bad;
      expect(() => deserializeCoinProof(serializeCoinProof(cp))).toThrow(/non-canonical digest/);
    }
  });

  it('rejects non-liftable x-only at each requireXOnlyPoint site', () => {
    const zero = new Uint8Array(32);
    for (const field of ['pkCreate', 'rCreate', 'rPrimeCreate', 'epk'] as const) {
      const cp = sampleCoinProof(10);
      if (field === 'pkCreate') cp.creatingNullifier.pkCreate = zero;
      if (field === 'rCreate') cp.creatingNullifier.rCreate = zero;
      if (field === 'rPrimeCreate') cp.creatingNullifier.rPrimeCreate = zero;
      if (field === 'epk') cp.epk = zero;
      expect(() => deserializeCoinProof(serializeCoinProof(cp))).toThrow(/invalid x-only/);
    }
  });

  it('serialize/deserialize Coin wrong-length throws', () => {
    expect(() =>
      serializeCoin({
        identifier: fill(16, 1),
        recipient: digestLabel('r'),
        amount: 1n,
        assetId: digestLabel('a'),
      }),
    ).toThrow(/identifier must be 32/);
    expect(() =>
      serializeCoin({
        identifier: digestLabel('i'),
        recipient: fill(16, 1),
        amount: 1n,
        assetId: digestLabel('a'),
      }),
    ).toThrow(/recipient must be 32/);
    expect(() =>
      serializeCoin({
        identifier: digestLabel('i'),
        recipient: digestLabel('r'),
        amount: 1n,
        assetId: fill(16, 1),
      }),
    ).toThrow(/assetId must be 32/);
    expect(() => deserializeCoin(new Uint8Array(10))).toThrow(/112 bytes/);
  });

  it('Cursor take/done errors via truncated and trailing wire', () => {
    const cp = sampleCoinProof(11);
    const bytes = serializeCoinProof(cp);
    expect(() => deserializeCoinProof(bytes.slice(0, 50))).toThrow(/truncated/);
    const trailing = new Uint8Array(bytes.length + 1);
    trailing.set(bytes);
    expect(() => deserializeCoinProof(trailing)).toThrow(/trailing bytes/);

    // Mid variable-length section: length prefix for proof is fully present,
    // but only one byte of the declared proof payload remains.
    const midProof = bytes.slice(0, 112 + 4 + 1);
    expect(() => deserializeCoinProof(midProof)).toThrow(/truncated/);

    // After the fixed Coin section, fewer than 4 bytes remain — takeU32Bytes
    // cannot even read the length prefix for CoinProof.proof.
    expect(() => deserializeCoinProof(bytes.slice(0, COIN_WIRE_LEN + 2))).toThrow(
      /missing length prefix/,
    );
  });

  it('readIssuanceTerms rejects overlong name and invalid issuance_version on wire', () => {
    const cp = sampleCoinProof(62);
    const creator = xOnlyFromSeed(40);

    const prefixWithoutTerms = (): Uint8Array[] => [
      serializeCoin(cp.coin),
      writeU32Be(cp.proof.length),
      cp.proof,
      writeU32Be(cp.inclusionProof.length),
      cp.inclusionProof,
      cp.creatingPrevAsh,
      cp.creatingNullifier.pkCreate,
      cp.creatingNullifier.rCreate,
      cp.creatingNullifier.rPrimeCreate,
      writeU64Be(cp.navOpening.size),
      cp.navOpening.mth,
      cp.navOpening.navRand,
      new Uint8Array([0x01]), // asset_terms present
    ];

    const suffix = (): Uint8Array[] => [
      cp.epk,
      writeU32Be(cp.ciphertext.length),
      cp.ciphertext,
      cp.detectTag,
    ];

    // Name length 256 (> MAX_ASSET_NAME_LEN 255), framed so takeU32Bytes succeeds.
    const name256 = fill(256, 0x41);
    const longNameBytes = concatParts([
      ...prefixWithoutTerms(),
      creator,
      new Uint8Array([2]), // decimals
      new Uint8Array([1]), // issuanceVersion 1
      writeU32Be(256),
      name256,
      ...suffix(),
    ]);
    expect(() => deserializeCoinProof(longNameBytes)).toThrow(/exceeds 255/);

    // Valid name framing, invalid issuance_version byte.
    const name = new TextEncoder().encode('ok');
    const badVerBytes = concatParts([
      ...prefixWithoutTerms(),
      creator,
      new Uint8Array([2]),
      new Uint8Array([3]), // invalid issuance_version
      writeU32Be(name.length),
      name,
      ...suffix(),
    ]);
    expect(() => deserializeCoinProof(badVerBytes)).toThrow(/issuance_version invalid/);
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

  it('issuance v2 roundtrip and invalid version / missing fields', () => {
    const creator = xOnlyFromSeed(21);
    const name = new TextEncoder().encode('CAP-Asset');
    const nameHash = sha256(name);
    const termsSalt = fill(32, 0x3a);
    const capTotal = 1_000_000n;
    const assetId = digestToBytes(
      assetIdV2(GENESIS_TAG, creator, nameHash, 8, 2, capTotal, termsSalt),
    );
    const terms: IssuanceTerms = {
      creatorPubkey: creator,
      decimals: 8,
      issuanceVersion: 2,
      name,
      capTotal,
      termsSalt,
    };
    const cp = sampleCoinProof(12, {
      coin: {
        identifier: digestLabel('id/v2'),
        recipient: digestLabel('recipient/v2'),
        amount: 5n,
        assetId,
      },
      assetTerms: terms,
    });
    expect(deserializeCoinProof(serializeCoinProof(cp)).assetTerms?.capTotal).toBe(capTotal);

    expect(() =>
      assertAssetIdMatchesTerms(cp.coin, {
        ...terms,
        issuanceVersion: 2,
        capTotal: undefined,
        termsSalt: undefined,
      }),
    ).toThrow(/missing cap_total/);
    expect(() => assertAssetIdMatchesTerms(cp.coin, { ...terms, issuanceVersion: 9 })).toThrow(
      /issuance_version invalid/,
    );

    // v1 with cap set on write.
    expect(() =>
      serializeCoinProof(
        sampleCoinProof(13, {
          coin: {
            identifier: digestLabel('id/v1bad'),
            recipient: digestLabel('r/v1bad'),
            amount: 1n,
            assetId: digestToBytes(assetIdV1(GENESIS_TAG, creator, nameHash, 2, 1)),
          },
          assetTerms: {
            creatorPubkey: creator,
            decimals: 2,
            issuanceVersion: 1,
            name,
            capTotal: 1n,
          },
        }),
      ),
    ).toThrow(/must not carry cap_total/);

    // Independently cover the terms_salt-only v1 rejection arm.
    expect(() =>
      serializeCoinProof(
        sampleCoinProof(130, {
          coin: {
            identifier: digestLabel('id/v1salt'),
            recipient: digestLabel('r/v1salt'),
            amount: 1n,
            assetId: digestToBytes(assetIdV1(GENESIS_TAG, creator, nameHash, 2, 1)),
          },
          assetTerms: {
            creatorPubkey: creator,
            decimals: 2,
            issuanceVersion: 1,
            name,
            termsSalt,
          },
        }),
      ),
    ).toThrow(/must not carry cap_total/);

    // v2 missing cap/salt on write.
    expect(() =>
      serializeCoinProof(
        sampleCoinProof(16, {
          coin: {
            identifier: digestLabel('id/v2miss'),
            recipient: digestLabel('r/v2miss'),
            amount: 1n,
            assetId,
          },
          assetTerms: {
            creatorPubkey: creator,
            decimals: 8,
            issuanceVersion: 2,
            name,
          },
        }),
      ),
    ).toThrow(/requires cap_total/);

    // cap_total present with missing terms_salt reaches the second v2 guard operand.
    expect(() =>
      serializeCoinProof(
        sampleCoinProof(160, {
          coin: {
            identifier: digestLabel('id/v2salt-missing'),
            recipient: digestLabel('r/v2salt-missing'),
            amount: 1n,
            assetId,
          },
          assetTerms: {
            creatorPubkey: creator,
            decimals: 8,
            issuanceVersion: 2,
            name,
            capTotal,
          },
        }),
      ),
    ).toThrow(/requires cap_total/);

    expect(() =>
      assertAssetIdMatchesTerms(cp.coin, {
        ...terms,
        issuanceVersion: 2,
        termsSalt: undefined,
      }),
    ).toThrow(/missing cap_total/);

    // invalid issuance version on write.
    expect(() =>
      serializeCoinProof(
        sampleCoinProof(17, {
          coin: {
            identifier: digestLabel('id/v9'),
            recipient: digestLabel('r/v9'),
            amount: 1n,
            assetId,
          },
          assetTerms: {
            creatorPubkey: creator,
            decimals: 8,
            issuanceVersion: 9,
            name,
          },
        }),
      ),
    ).toThrow(/issuance_version invalid/);

    // name too long on write.
    expect(() =>
      serializeCoinProof(
        sampleCoinProof(14, {
          coin: {
            identifier: digestLabel('id/long'),
            recipient: digestLabel('r/long'),
            amount: 1n,
            assetId,
          },
          assetTerms: {
            creatorPubkey: creator,
            decimals: 8,
            issuanceVersion: 2,
            name: fill(300, 0x41),
            capTotal,
            termsSalt,
          },
        }),
      ),
    ).toThrow(/name length/);
  });

  it('rejects invalid asset_terms.presence byte', () => {
    const cp = sampleCoinProof(15);
    const bytes = serializeCoinProof(cp);
    // presence is a single byte after nav_opening; find 0x00 and flip to 0x02.
    // Safer: craft by serializing then patching presence position.
    // Layout: coin(112) + proof_len(4)+proof + incl_len(4)+incl + prevAsh(32) +
    // nullifier(96) + size(8)+mth(32)+navRand(32) + presence(1)
    const proofLen = cp.proof.length;
    const inclLen = cp.inclusionProof.length;
    const presenceOff = 112 + 4 + proofLen + 4 + inclLen + 32 + 96 + 8 + 32 + 32;
    const patched = bytes.slice();
    patched[presenceOff] = 0x02;
    expect(() => deserializeCoinProof(patched)).toThrow(/presence invalid/);
  });
});
