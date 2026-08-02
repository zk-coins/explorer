/**
 * §5.6 confirmation open + state rendering fixtures.
 */

import { describe, expect, it } from 'vitest';
import type { InscriptionEntry } from '@/lib/api/types';
import { deserializeCoinProof, serializeCoinProof, type CoinProof } from '@/lib/bundle/coinProof';
import { openConfirmationBlob } from '@/lib/bearer/confirmation';
import { stateFromInscriptions } from '@/lib/bearer/stateFromNode';
import { encodeHexLower } from '@/lib/crypto/bytes';
import { zbeSeal } from '@/lib/crypto/zbe';

function fill(n: number, v: number): Uint8Array {
  return Uint8Array.from({ length: n }, () => v);
}

function sampleCoinProof(seed: number): CoinProof {
  return {
    coin: {
      identifier: fill(32, seed),
      recipient: fill(32, seed + 1),
      amount: 1_000_000n + BigInt(seed),
      assetId: fill(32, seed + 2),
    },
    proof: fill(64, seed + 3),
    inclusionProof: fill(32, seed + 4),
    creatingPrevAsh: fill(32, seed + 5),
    creatingNullifier: {
      pkCreate: fill(32, seed + 6),
      rCreate: fill(32, seed + 7),
      rPrimeCreate: fill(32, seed + 8),
    },
    navOpening: {
      size: 42n,
      mth: fill(32, seed + 9),
      navRand: fill(32, seed + 10),
    },
    epk: fill(32, seed + 11),
    ciphertext: fill(48, seed + 12),
    detectTag: fill(32, seed + 13),
  };
}

describe('§5.6 confirmation open', () => {
  it('opens a sealed CoinProof and exposes coin fields', () => {
    const kTx = fill(32, 0xab);
    const cp = sampleCoinProof(1);
    const plain = serializeCoinProof(cp);
    const { ciphertext, blobId } = zbeSeal(kTx, plain);

    const opened = openConfirmationBlob(kTx, ciphertext, blobId);
    expect(opened.fatalError).toBeUndefined();
    expect(opened.coinProof).toBeDefined();
    expect(opened.coinProof!.coin.amount).toBe(cp.coin.amount);
    expect(encodeHexLower(opened.coinProof!.creatingNullifier.pkCreate)).toBe(
      encodeHexLower(cp.creatingNullifier.pkCreate),
    );

    const checkIds = opened.checks.map((c) => c.id);
    expect(checkIds).toContain('blob_id');
    expect(checkIds).toContain('zbe_open');
    expect(checkIds).toContain('coinproof_decode');
    expect(opened.checks.every((c) => c.status === 'pass')).toBe(true);

    // Round-trip deserialize of the same plaintext.
    expect(deserializeCoinProof(plain).coin.amount).toBe(cp.coin.amount);
  });

  it('rejects manipulated ciphertext via blob_id check', () => {
    const kTx = fill(32, 0xcd);
    const plain = serializeCoinProof(sampleCoinProof(2));
    const { ciphertext, blobId } = zbeSeal(kTx, plain);
    const tampered = ciphertext.slice();
    tampered[20]! ^= 0xff;

    const opened = openConfirmationBlob(kTx, tampered, blobId);
    expect(opened.fatalError).toMatch(/blob_id mismatch/);
    expect(opened.checks.find((c) => c.id === 'blob_id')?.status).toBe('fail');
    expect(opened.coinProof).toBeUndefined();
  });
});

/**
 * §3.10 state is never invented by the explorer — one fixture per closed state
 * as it arrives from node inscription data.
 */
describe('§5.6 state fixtures (from node data)', () => {
  const pk = 'aa'.repeat(32);

  function fixture(state: 'pending' | 'completed' | 'failed'): InscriptionEntry[] {
    return [
      {
        txid: 'bb'.repeat(32),
        height: 100,
        tx_index: 0,
        vin_index: 0,
        count: 1,
        format: 1,
        nullifiers: [{ pubkey: pk, r: 'cc'.repeat(32), state }],
        confirmation_state: state === 'completed' ? 'completed' : 'pending',
      },
    ];
  }

  it('surfaces pending from inscription data', () => {
    const hit = stateFromInscriptions(pk, fixture('pending'));
    expect(hit?.state).toBe('pending');
  });

  it('surfaces completed from inscription data', () => {
    const hit = stateFromInscriptions(pk, fixture('completed'));
    expect(hit?.state).toBe('completed');
  });

  it('surfaces failed from inscription data', () => {
    const hit = stateFromInscriptions(pk, fixture('failed'));
    expect(hit?.state).toBe('failed');
  });

  it('returns undefined when Pk is absent — never invents a state', () => {
    expect(stateFromInscriptions('dd'.repeat(32), fixture('completed'))).toBeUndefined();
  });
});
