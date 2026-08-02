/**
 * §5.6 confirmation open + state rendering fixtures.
 */

import { describe, expect, it } from 'vitest';
import type { InscriptionEntry, InscriptionsResponse } from '@/lib/api/types';
import { deserializeCoinProof, serializeCoinProof } from '@/lib/bundle/coinProof';
import {
  findCreatingPkInInscriptions,
  openConfirmationBlob,
  resolveConfirmationLink,
} from '@/lib/bearer/confirmation';
import { stateFromInscriptions } from '@/lib/bearer/stateFromNode';
import { encodeHexLower } from '@/lib/crypto/bytes';
import { zbeSeal } from '@/lib/crypto/zbe';
import type { TxFragmentOk } from '@/lib/fragments';
import { fill, sampleCoinProof, xOnlyFromSeed } from './fixtures/crypto';

describe('§5.6 confirmation open', () => {
  it('opens a sealed CoinProof and exposes coin fields', () => {
    const kTx = fill(32, 0x2b);
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
    const kTx = fill(32, 0x2c);
    const plain = serializeCoinProof(sampleCoinProof(2));
    const { ciphertext, blobId } = zbeSeal(kTx, plain);
    const tampered = ciphertext.slice();
    tampered[20]! ^= 0xff;

    const opened = openConfirmationBlob(kTx, tampered, blobId);
    expect(opened.fatalError).toMatch(/blob_id mismatch/);
    expect(opened.checks.find((c) => c.id === 'blob_id')?.status).toBe('fail');
    expect(opened.coinProof).toBeUndefined();
  });

  it('rejects non-canonical / invalid curve material in CoinProof (epk)', () => {
    const kTx = fill(32, 0x2d);
    const cp = sampleCoinProof(3);
    // Force an invalid x-only epk (all zeros is not a valid curve point).
    cp.epk = new Uint8Array(32);
    const plain = serializeCoinProof(cp);
    const { ciphertext, blobId } = zbeSeal(kTx, plain);
    const opened = openConfirmationBlob(kTx, ciphertext, blobId);
    expect(opened.coinProof).toBeUndefined();
    expect(opened.checks.find((c) => c.id === 'coinproof_decode')?.status).toBe('fail');
  });

  it("rejects non-liftable R'_create independently of epk/Pk", () => {
    const kTx = fill(32, 0x2e);
    const cp = sampleCoinProof(5);
    // All-zero R' does not lift to a secp256k1 point.
    cp.creatingNullifier = {
      ...cp.creatingNullifier,
      rPrimeCreate: new Uint8Array(32),
    };
    const plain = serializeCoinProof(cp);
    const { ciphertext, blobId } = zbeSeal(kTx, plain);
    const opened = openConfirmationBlob(kTx, ciphertext, blobId);
    expect(opened.coinProof).toBeUndefined();
    expect(opened.checks.find((c) => c.id === 'coinproof_decode')?.status).toBe('fail');
    expect(opened.fatalError).toMatch(/R'/);
  });
});

/**
 * §3.10 state is never invented by the explorer — one fixture per closed state
 * as it arrives from node inscription data. Match is on the full (Pk, R) pair.
 */
describe('§5.6 state fixtures (from node data)', () => {
  const pk = 'aa'.repeat(32);
  const r = 'cc'.repeat(32);

  function fixture(state: 'pending' | 'completed' | 'failed'): InscriptionEntry[] {
    return [
      {
        txid: 'bb'.repeat(32),
        height: 100n,
        tx_index: 0,
        vin_index: 0,
        count: 1,
        format: 1,
        nullifiers: [{ pubkey: pk, r, state }],
        confirmation_state: state === 'completed' ? 'completed' : 'pending',
      },
    ];
  }

  it('surfaces pending / completed / failed from node data only', () => {
    for (const state of ['pending', 'completed', 'failed'] as const) {
      const hit = stateFromInscriptions(pk, r, fixture(state));
      expect(hit?.state).toBe(state);
    }
  });

  it('does not take completed state from same Pk with different R', () => {
    const otherR = 'dd'.repeat(32);
    const inscriptions: InscriptionEntry[] = [
      {
        txid: 'ee'.repeat(32),
        height: 50n,
        tx_index: 0,
        vin_index: 0,
        count: 1,
        format: 1,
        nullifiers: [{ pubkey: pk, r: otherR, state: 'completed' }],
        confirmation_state: 'completed',
      },
    ];
    // Looking up (pk, r) must not inherit state from (pk, otherR).
    expect(stateFromInscriptions(pk, r, inscriptions)).toBeUndefined();
    expect(stateFromInscriptions(pk, otherR, inscriptions)?.state).toBe('completed');
  });
});

describe('§5.6 Path-B honesty + inscription pagination', () => {
  it('marks present:false as open (not pass)', async () => {
    const kTx = fill(32, 0x31);
    const cp = sampleCoinProof(4);
    const plain = serializeCoinProof(cp);
    const { ciphertext, blobId } = zbeSeal(kTx, plain);
    const frag: TxFragmentOk = {
      status: 'ok',
      kind: 'tx',
      bundle: blobId,
      view: kTx,
    };

    const view = await resolveConfirmationLink(frag, {
      fetchInfo: async () => ({
        network: 'regtest',
        protocol_version: 'v1',
        finality_confirmations: 6,
        activation_height: 0n,
        max_blob_bytes: 1_048_576n,
        features: [],
      }),
      fetchBlob: async () => ciphertext,
      fetchNullifier: async () => ({
        present: false,
        audit_path: [],
        tree_size: 0n,
        root: 'aa'.repeat(32),
        tip_block_hash: 'bb'.repeat(32),
        tip_height: 10n,
      }),
      fetchInscriptions: async () => ({ inscriptions: [] }),
    });

    const pathB = view.checks.find((c) => c.id === 'nullifier_path_b');
    expect(pathB?.status).toBe('open');
    expect(pathB?.status).not.toBe('pass');
    // Open verification steps remain open:
    for (const id of ['plonky2_proof', 'inclusion_proof', 'nav_canonical', 's2c_binding']) {
      expect(view.checks.find((c) => c.id === id)?.status).toBe('open');
    }
  });

  it('walks inscription cursor pages until creating (Pk, R) is found', async () => {
    const pkBytes = xOnlyFromSeed(99);
    const rBytes = xOnlyFromSeed(100);
    const pkHex = encodeHexLower(pkBytes);
    const rHex = encodeHexLower(rBytes);
    const page1: InscriptionsResponse = {
      inscriptions: [
        {
          txid: '11'.repeat(32),
          height: 1n,
          tx_index: 0,
          vin_index: 0,
          count: 1,
          format: 1,
          confirmation_state: 'completed',
          nullifiers: [{ pubkey: '22'.repeat(32), r: '33'.repeat(32), state: 'completed' }],
        },
      ],
      next_height: 2n,
      next_tx_index: 0,
      next_vin_index: 0,
    };
    const page2: InscriptionsResponse = {
      inscriptions: [
        {
          txid: '44'.repeat(32),
          height: 2n,
          tx_index: 0,
          vin_index: 0,
          count: 1,
          format: 1,
          confirmation_state: 'completed',
          // Same Pk with wrong R must not match; correct pair is next entry.
          nullifiers: [
            { pubkey: pkHex, r: '55'.repeat(32), state: 'completed' },
            { pubkey: pkHex, r: rHex, state: 'completed' },
          ],
        },
      ],
    };
    // Fix count to match nullifiers length for page2.
    page2.inscriptions[0]!.count = 2;

    let calls = 0;
    const { hit, pagesScanned } = await findCreatingPkInInscriptions(
      pkHex,
      rHex,
      async (opts: { from_height?: bigint | number } = {}) => {
        calls += 1;
        if (opts.from_height === undefined) {
          return page1;
        }
        return page2;
      },
    );

    expect(pagesScanned).toBe(2);
    expect(calls).toBe(2);
    expect(hit?.state).toBe('completed');
    expect(hit?.txid).toBe('44'.repeat(32));
  });

  it('does not set completed when inscription has same Pk but different R', async () => {
    const kTx = fill(32, 0x41);
    const cp = sampleCoinProof(6);
    const plain = serializeCoinProof(cp);
    const { ciphertext, blobId } = zbeSeal(kTx, plain);
    const pkHex = encodeHexLower(cp.creatingNullifier.pkCreate);
    const wrongR = 'ff'.repeat(32);

    const view = await resolveConfirmationLink(
      { status: 'ok', kind: 'tx', bundle: blobId, view: kTx },
      {
        fetchInfo: async () => ({
          network: 'regtest',
          protocol_version: 'v1',
          finality_confirmations: 6,
          activation_height: 0n,
          max_blob_bytes: 1_048_576n,
          features: [],
        }),
        fetchBlob: async () => ciphertext,
        fetchNullifier: async () => ({
          present: true,
          position: 0n,
          leaf: wrongR, // leaf R ≠ R_create
          audit_path: [],
          tree_size: 1n,
          root: 'aa'.repeat(32),
          tip_block_hash: 'bb'.repeat(32),
          tip_height: 100n,
        }),
        fetchInscriptions: async () => ({
          inscriptions: [
            {
              txid: '99'.repeat(32),
              height: 90n,
              tx_index: 0,
              vin_index: 0,
              count: 1,
              format: 1,
              confirmation_state: 'completed',
              nullifiers: [{ pubkey: pkHex, r: wrongR, state: 'completed' }],
            },
          ],
        }),
      },
    );

    // Must not surface completed from the wrong R pair.
    expect(view.state).toBeUndefined();
    expect(view.checks.find((c) => c.id === 'state_310')?.status).toBe('open');
    expect(view.checks.find((c) => c.id === 'nullifier_r_match')?.status).toBe('fail');
  });
});
