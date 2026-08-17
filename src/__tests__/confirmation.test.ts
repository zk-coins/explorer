/**
 * §5.6 confirmation open + state rendering fixtures.
 */

import { describe, expect, it } from 'vitest';
import { fetchInscriptions, fetchNullifier } from '@/lib/api/client';
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
import { digestLabel, fill, sampleCoinProof, xOnlyFromSeed } from './fixtures/crypto';

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
      maxInscriptionPages: 2,
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
      { pageLimit: 200, maxPages: 50 },
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
    expect(view.coin).toBeUndefined();
    expect(view.creatingNullifier).toBeUndefined();
    expect(view.navOpening).toBeUndefined();
    expect(view.checks.find((c) => c.id === 'state_310')?.status).toBe('fail');
    expect(view.checks.find((c) => c.id === 'nullifier_r_match')?.status).toBe('fail');
    expect(view.fatalError).toBeDefined();
  });

  it('Path-B R mismatch with correct inscription pair is fatal and does not set state', async () => {
    const kTx = fill(32, 0x42);
    const cp = sampleCoinProof(7);
    const plain = serializeCoinProof(cp);
    const { ciphertext, blobId } = zbeSeal(kTx, plain);
    const pkHex = encodeHexLower(cp.creatingNullifier.pkCreate);
    const rHex = encodeHexLower(cp.creatingNullifier.rCreate);
    const wrongLeaf = 'ff'.repeat(32);

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
          leaf: wrongLeaf,
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
              // Correct (Pk, R_create) — must still not set state under Path-B R mismatch.
              nullifiers: [{ pubkey: pkHex, r: rHex, state: 'completed' }],
            },
          ],
        }),
      },
    );

    expect(view.state).toBeUndefined();
    expect(view.coin).toBeUndefined();
    expect(view.creatingNullifier).toBeUndefined();
    expect(view.navOpening).toBeUndefined();
    expect(view.anchoring?.confirmations).toBeUndefined();
    expect(view.checks.find((c) => c.id === 'nullifier_r_match')?.status).toBe('fail');
    expect(view.checks.find((c) => c.id === 'state_310')?.status).toBe('fail');
    expect(view.fatalError).toBeDefined();
  });

  it('Path-B present without position with correct inscription pair is fatal and does not set state', async () => {
    const kTx = fill(32, 0x42);
    const cp = sampleCoinProof(7);
    const plain = serializeCoinProof(cp);
    const { ciphertext, blobId } = zbeSeal(kTx, plain);
    const pkHex = encodeHexLower(cp.creatingNullifier.pkCreate);
    const rHex = encodeHexLower(cp.creatingNullifier.rCreate);

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
          leaf: rHex,
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
              nullifiers: [{ pubkey: pkHex, r: rHex, state: 'completed' }],
            },
          ],
        }),
      },
    );

    expect(view.state).toBeUndefined();
    expect(view.coin).toBeUndefined();
    expect(view.creatingNullifier).toBeUndefined();
    expect(view.navOpening).toBeUndefined();
    expect(view.anchoring?.confirmations).toBeUndefined();
    expect(view.checks.find((c) => c.id === 'nullifier_path_b')?.status).toBe('fail');
    expect(view.checks.find((c) => c.id === 'state_310')?.status).toBe('fail');
    expect(view.fatalError).toBeDefined();
  });

  it('Path-B malformed wire response (present without position) is fatal and does not set state from inscriptions', async () => {
    const kTx = fill(32, 0x44);
    const cp = sampleCoinProof(9);
    const plain = serializeCoinProof(cp);
    const { ciphertext, blobId } = zbeSeal(kTx, plain);
    const pkHex = encodeHexLower(cp.creatingNullifier.pkCreate);
    const rHex = encodeHexLower(cp.creatingNullifier.rCreate);

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
        // Real fetch/parse path: present:true without position/leaf → NodeApiError malformed_response.
        fetchNullifier: (pk, opts) =>
          fetchNullifier(pk, {
            ...opts,
            fetchImpl: async () =>
              new Response(
                JSON.stringify({
                  present: true,
                  audit_path: [],
                  tree_size: '1',
                  root: 'aa'.repeat(32),
                  tip_block_hash: 'bb'.repeat(32),
                  tip_height: '100',
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } },
              ),
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
              nullifiers: [{ pubkey: pkHex, r: rHex, state: 'completed' }],
            },
          ],
        }),
      },
    );

    expect(view.fatalError).toBeDefined();
    expect(view.state).toBeUndefined();
    expect(view.coin).toBeUndefined();
    expect(view.creatingNullifier).toBeUndefined();
    expect(view.navOpening).toBeUndefined();
    expect(view.checks.find((c) => c.id === 'state_310')?.status).toBe('fail');
    expect(view.checks.find((c) => c.id === 'nullifier_path_b')?.status).toBe('fail');
  });

  it('inscriptions malformed_response is fail-closed on state_310', async () => {
    const kTx = fill(32, 0x46);
    const cp = sampleCoinProof(11);
    const plain = serializeCoinProof(cp);
    const { ciphertext, blobId } = zbeSeal(kTx, plain);

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
        // present:false → Path-B stays open; inscriptions path is reached.
        fetchNullifier: async () => ({
          present: false,
          audit_path: [],
          tree_size: 1n,
          root: 'bb'.repeat(32),
          tip_block_hash: 'cc'.repeat(32),
          tip_height: 100n,
        }),
        // Real parser: JSON null → NodeApiError malformed_response.
        fetchInscriptions: (opts) =>
          fetchInscriptions({
            ...opts,
            fetchImpl: async () =>
              new Response(JSON.stringify(null), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              }),
          }),
      },
    );

    const state310 = view.checks.find((c) => c.id === 'state_310');
    expect(state310?.status).toBe('fail');
    expect(state310?.detail).toMatch(/inscriptions/);
    expect(state310?.detail).toMatch(/not an object/);
    expect(state310?.detail).not.toMatch(/^Could not load inscriptions:/);
    expect(view.fatalError).toBeDefined();
    expect(view.fatalError).toBe(state310?.detail);
    expect(view.state).toBeUndefined();
    expect(view.coin).toBeUndefined();
    expect(view.creatingNullifier).toBeUndefined();
    expect(view.navOpening).toBeUndefined();
  });

  it('inscriptions transport error stays open on state_310', async () => {
    const kTx = fill(32, 0x46);
    const cp = sampleCoinProof(11);
    const plain = serializeCoinProof(cp);
    const { ciphertext, blobId } = zbeSeal(kTx, plain);

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
        // present:false → Path-B stays open; inscriptions path is reached.
        fetchNullifier: async () => ({
          present: false,
          audit_path: [],
          tree_size: 1n,
          root: 'bb'.repeat(32),
          tip_block_hash: 'cc'.repeat(32),
          tip_height: 100n,
        }),
        fetchInscriptions: async () => {
          throw new Error('ECONNRESET');
        },
      },
    );

    const state310 = view.checks.find((c) => c.id === 'state_310');
    expect(state310?.status).toBe('open');
    expect(state310?.detail).toMatch(/^Could not load inscriptions:/);
    expect(view.fatalError).toBeUndefined();
    expect(view.state).toBeUndefined();
  });

  it('Path-B inconsistency fails state_310 without fetching inscriptions', async () => {
    const pathNames = [
      'present without position',
      'present without leaf',
      'malformed_response (parser throws)',
      'leaf mismatch',
    ] as const;

    for (const pathName of pathNames) {
      const kTx = fill(32, 0x45);
      const cp = sampleCoinProof(10);
      const plain = serializeCoinProof(cp);
      const { ciphertext, blobId } = zbeSeal(kTx, plain);
      const rHex = encodeHexLower(cp.creatingNullifier.rCreate);

      let inscCalls = 0;
      const fetchInscriptions = async () => {
        inscCalls += 1;
        throw new Error('inscriptions must not be fetched');
      };

      const fetchNf =
        pathName === 'present without position'
          ? async () => ({
              present: true as const,
              leaf: rHex,
              audit_path: [] as string[],
              tree_size: 1n,
              root: 'aa'.repeat(32),
              tip_block_hash: 'bb'.repeat(32),
              tip_height: 100n,
            })
          : pathName === 'present without leaf'
            ? async () => ({
                present: true as const,
                position: 0n,
                audit_path: [] as string[],
                tree_size: 1n,
                root: 'aa'.repeat(32),
                tip_block_hash: 'bb'.repeat(32),
                tip_height: 100n,
              })
            : pathName === 'malformed_response (parser throws)'
              ? (pk: string, opts?: Parameters<typeof fetchNullifier>[1]) =>
                  fetchNullifier(pk, {
                    ...opts,
                    fetchImpl: async () =>
                      new Response(
                        JSON.stringify({
                          present: true,
                          audit_path: [],
                          tree_size: '1',
                          root: 'aa'.repeat(32),
                          tip_block_hash: 'bb'.repeat(32),
                          tip_height: '100',
                        }),
                        { status: 200, headers: { 'Content-Type': 'application/json' } },
                      ),
                  })
              : async () => ({
                  present: true as const,
                  position: 0n,
                  leaf: 'ff'.repeat(32),
                  audit_path: [] as string[],
                  tree_size: 1n,
                  root: 'aa'.repeat(32),
                  tip_block_hash: 'bb'.repeat(32),
                  tip_height: 100n,
                });

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
          fetchNullifier: fetchNf,
          fetchInscriptions,
        },
      );

      const state310Detail = view.checks.find((ch) => ch.id === 'state_310')?.detail;
      expect(view.checks.find((ch) => ch.id === 'state_310')?.status, pathName).toBe('fail');
      if (pathName === 'present without position') {
        expect(state310Detail, pathName).toContain(
          'Path-B present without position — cannot bind to R_create',
        );
      } else if (pathName === 'present without leaf') {
        expect(state310Detail, pathName).toContain(
          'Path-B present without leaf — cannot bind to R_create',
        );
      } else if (pathName === 'malformed_response (parser throws)') {
        // Parser detail (err.message), not the NodeApiError.code string.
        expect(state310Detail, pathName).toContain('nullifier (present)');
        expect(state310Detail, pathName).toContain('position');
      } else {
        expect(state310Detail, pathName).toContain('Path-B leaf');
        expect(state310Detail, pathName).toContain('≠ R_create');
      }
      expect(view.state, pathName).toBeUndefined();
      expect(view.coin, pathName).toBeUndefined();
      expect(view.creatingNullifier, pathName).toBeUndefined();
      expect(view.navOpening, pathName).toBeUndefined();
      expect(view.fatalError, pathName).toBeDefined();
      expect(inscCalls, pathName).toBe(0);
    }
  });

  it('reveal height above tip is fatal and does not set confirmations or state', async () => {
    const kTx = fill(32, 0x43);
    const cp = sampleCoinProof(8);
    const plain = serializeCoinProof(cp);
    const { ciphertext, blobId } = zbeSeal(kTx, plain);
    const pkHex = encodeHexLower(cp.creatingNullifier.pkCreate);
    const rHex = encodeHexLower(cp.creatingNullifier.rCreate);

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
          leaf: rHex,
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
              height: 200n,
              tx_index: 0,
              vin_index: 0,
              count: 1,
              format: 1,
              confirmation_state: 'completed',
              nullifiers: [{ pubkey: pkHex, r: rHex, state: 'completed' }],
            },
          ],
        }),
      },
    );

    expect(view.state).toBeUndefined();
    expect(view.coin).toBeUndefined();
    expect(view.creatingNullifier).toBeUndefined();
    expect(view.navOpening).toBeUndefined();
    expect(view.anchoring?.confirmations).toBeUndefined();
    expect(view.checks.find((c) => c.id === 'state_310')?.status).toBe('fail');
    expect(view.fatalError).toBeDefined();
  });

  it('parseHolderHint via resolveConfirmationLink holders path + full success state', async () => {
    const kTx = fill(32, 0x51);
    const { assetIdV1, digestToBytes, GENESIS_TAG } = await import('@zkcoins/sdk');
    const { sha256 } = await import('@/lib/crypto/sha256');
    const creator = xOnlyFromSeed(30);
    const name = new TextEncoder().encode('DemoAsset');
    const nameHash = sha256(name);
    const assetId = digestToBytes(assetIdV1(GENESIS_TAG, creator, nameHash, 2, 1));
    const cp = sampleCoinProof(20, {
      coin: {
        identifier: digestLabel('id/conf-full'),
        recipient: digestLabel('r/conf-full'),
        amount: 3n,
        assetId,
      },
      assetTerms: {
        creatorPubkey: creator,
        decimals: 2,
        issuanceVersion: 1,
        name,
      },
    });
    const plain = serializeCoinProof(cp);
    const { ciphertext, blobId } = zbeSeal(kTx, plain);
    const pkHex = encodeHexLower(cp.creatingNullifier.pkCreate);
    const rHex = encodeHexLower(cp.creatingNullifier.rCreate);

    const view = await resolveConfirmationLink(
      {
        status: 'ok',
        kind: 'tx',
        bundle: blobId,
        view: kTx,
        holderHint: '@https://holder.example',
      },
      {
        fetchInfo: async () => ({
          network: 'regtest',
          protocol_version: 'v1',
          finality_confirmations: 6,
          activation_height: 0n,
          max_blob_bytes: 1_048_576n,
          features: [],
        }),
        fetchBlobFromHolders: async () => ({ body: ciphertext, holder: 'https://holder.example' }),
        fetchNullifier: async () => ({
          present: true,
          position: 2n,
          leaf: rHex,
          audit_path: [],
          tree_size: 3n,
          root: 'aa'.repeat(32),
          tip_block_hash: 'bb'.repeat(32),
          tip_height: 200n,
        }),
        fetchInscriptions: async () => ({
          inscriptions: [
            {
              txid: 'ee'.repeat(32),
              height: 150n,
              tx_index: 0,
              vin_index: 0,
              count: 1,
              format: 1,
              confirmation_state: 'completed',
              nullifiers: [{ pubkey: pkHex, r: rHex, state: 'completed' }],
            },
          ],
        }),
      },
    );

    expect(view.checks.find((c) => c.id === 'fetch_blob')?.status).toBe('pass');
    expect(view.checks.find((c) => c.id === 'nullifier_path_b')?.status).toBe('pass');
    expect(view.checks.find((c) => c.id === 'nullifier_r_match')?.status).toBe('pass');
    expect(view.checks.find((c) => c.id === 'state_310')?.status).toBe('pass');
    expect(view.state).toBe('completed');
    expect(view.anchoring?.revealTxid).toBe('ee'.repeat(32));
    expect(view.anchoring?.confirmations).toBe(200n - 150n + 1n);
    expect(view.assetTermsName).toBe('DemoAsset');
  });

  it('holderHint comma-list, bare http, op: and empty parse via holders empty path', async () => {
    const kTx = fill(32, 0x52);
    const cp = sampleCoinProof(21);
    const plain = serializeCoinProof(cp);
    const { ciphertext, blobId } = zbeSeal(kTx, plain);

    // Comma-separated holders (all valid http(s)).
    const v1 = await resolveConfirmationLink(
      {
        status: 'ok',
        kind: 'tx',
        bundle: blobId,
        view: kTx,
        holderHint: 'http://a.example, https://b.example',
      },
      {
        fetchInfo: async () => ({
          network: 'regtest',
          protocol_version: 'v1',
          finality_confirmations: 6,
          activation_height: 0n,
          max_blob_bytes: 1_048_576n,
          features: [],
        }),
        fetchBlobFromHolders: async (_id, holders) => {
          expect(holders).toEqual(['http://a.example', 'https://b.example']);
          return { body: ciphertext, holder: holders[0]! };
        },
        fetchNullifier: async () => {
          throw new Error('nf boom');
        },
        fetchInscriptions: async () => {
          throw new Error('insc boom');
        },
      },
    );
    expect(v1.checks.find((c) => c.id === 'nullifier_path_b')?.status).toBe('fail');
    expect(v1.checks.find((c) => c.id === 'state_310')?.status).toBe('open');

    // Bare https without @.
    const v2 = await resolveConfirmationLink(
      {
        status: 'ok',
        kind: 'tx',
        bundle: blobId,
        view: kTx,
        holderHint: 'https://solo.example',
      },
      {
        fetchInfo: async () => ({
          network: 'regtest',
          protocol_version: 'v1',
          finality_confirmations: 6,
          activation_height: 0n,
          max_blob_bytes: 1_048_576n,
          features: [],
        }),
        fetchBlobFromHolders: async () => ({ body: ciphertext, holder: 'https://solo.example' }),
        fetchNullifier: async () => ({
          present: false,
          audit_path: [],
          tree_size: 0n,
          root: 'aa'.repeat(32),
          tip_block_hash: 'bb'.repeat(32),
          tip_height: 1n,
        }),
        fetchInscriptions: async () => ({ inscriptions: [] }),
      },
    );
    expect(v2.checks.find((c) => c.id === 'fetch_blob')?.status).toBe('pass');

    // op: prefix and @non-http → no holders → node path.
    const v3 = await resolveConfirmationLink(
      {
        status: 'ok',
        kind: 'tx',
        bundle: blobId,
        view: kTx,
        holderHint: 'op:pkhex',
      },
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
          present: false,
          audit_path: [],
          tree_size: 0n,
          root: 'aa'.repeat(32),
          tip_block_hash: 'bb'.repeat(32),
          tip_height: 1n,
        }),
        fetchInscriptions: async () => ({ inscriptions: [] }),
      },
    );
    expect(v3.checks.find((c) => c.id === 'fetch_blob')?.detail).toMatch(/node Blossom/);
  });

  it('holderHint with invalid locator fails closed before any blob fetch', async () => {
    const kTx = fill(32, 0x52);
    const cp = sampleCoinProof(21);
    const plain = serializeCoinProof(cp);
    const { blobId } = zbeSeal(kTx, plain);

    let fetchFromHoldersCalled = false;
    let fetchBlobCalled = false;
    const view = await resolveConfirmationLink(
      {
        status: 'ok',
        kind: 'tx',
        bundle: blobId,
        view: kTx,
        holderHint: 'http://a.example, not-a-url, https://b.example',
      },
      {
        fetchInfo: async () => {
          throw new Error('fetchInfo must not run on invalid holder hint');
        },
        fetchBlobFromHolders: async () => {
          fetchFromHoldersCalled = true;
          throw new Error('holders must not be called');
        },
        fetchBlob: async () => {
          fetchBlobCalled = true;
          throw new Error('node blob must not be called');
        },
      },
    );

    expect(view.fatalError).toBe('holder hint contains an invalid locator at index 1');
    expect(view.checks.find((c) => c.id === 'fetch_blob')?.status).toBe('fail');
    expect(view.checks.find((c) => c.id === 'fetch_blob')?.detail).toBe(
      'holder hint contains an invalid locator at index 1',
    );
    expect(fetchFromHoldersCalled).toBe(false);
    expect(fetchBlobCalled).toBe(false);
    expect(view.coin).toBeUndefined();
    expect(view.creatingNullifier).toBeUndefined();
    expect(view.navOpening).toBeUndefined();
    expect(view.state).toBeUndefined();
  });

  it('@https:// invalid holderHint fails closed before network', async () => {
    const kTx = fill(32, 0x58);
    const plain = serializeCoinProof(sampleCoinProof(26));
    const { blobId } = zbeSeal(kTx, plain);

    let fetchFromHoldersCalled = false;
    let fetchBlobCalled = false;
    const view = await resolveConfirmationLink(
      {
        status: 'ok',
        kind: 'tx',
        bundle: blobId,
        view: kTx,
        holderHint: '@https://',
      },
      {
        fetchInfo: async () => {
          throw new Error('fetchInfo must not run');
        },
        fetchBlobFromHolders: async () => {
          fetchFromHoldersCalled = true;
          throw new Error('holders must not be called');
        },
        fetchBlob: async () => {
          fetchBlobCalled = true;
          throw new Error('node blob must not be called');
        },
      },
    );

    expect(view.fatalError).toBe('holder hint contains an invalid locator');
    expect(view.checks.find((c) => c.id === 'fetch_blob')?.status).toBe('fail');
    expect(view.checks.find((c) => c.id === 'fetch_blob')?.detail).toBe(
      'holder hint contains an invalid locator',
    );
    expect(fetchFromHoldersCalled).toBe(false);
    expect(fetchBlobCalled).toBe(false);
    expect(view.coin).toBeUndefined();
  });

  it('openConfirmationBlob ZbeError with chunkIndex path', () => {
    const kTx = fill(32, 0x53);
    const { ciphertext, blobId } = zbeSeal(kTx, new TextEncoder().encode('x'));
    // Wrong key: blob_id still matches, zbe fails with auth_failed + chunkIndex.
    const wrongKey = fill(32, 0x99);
    const opened2 = openConfirmationBlob(wrongKey, ciphertext, blobId);
    expect(opened2.checks.find((c) => c.id === 'zbe_open')?.status).toBe('fail');
    expect(opened2.fatalError).toMatch(/auth_failed/);
    expect(opened2.fatalError).toMatch(/chunk/);

    const badLength = openConfirmationBlob(new Uint8Array(16), ciphertext, blobId);
    expect(badLength.fatalError).toMatch(/bad_key_length/);
    expect(badLength.fatalError).not.toMatch(/chunk/);
  });

  it('@ftp:// holderHint fails closed before any blob fetch', async () => {
    const kTx = fill(32, 0x56);
    const plain = serializeCoinProof(sampleCoinProof(24));
    const { blobId } = zbeSeal(kTx, plain);

    let fetchFromHoldersCalled = false;
    let fetchBlobCalled = false;
    const view = await resolveConfirmationLink(
      {
        status: 'ok',
        kind: 'tx',
        bundle: blobId,
        view: kTx,
        holderHint: '@ftp://not-http.example',
      },
      {
        fetchInfo: async () => {
          throw new Error('fetchInfo must not run');
        },
        fetchBlobFromHolders: async () => {
          fetchFromHoldersCalled = true;
          throw new Error('holders must not be called');
        },
        fetchBlob: async () => {
          fetchBlobCalled = true;
          throw new Error('node blob must not be called');
        },
      },
    );

    expect(view.fatalError).toBe('holder hint contains an invalid locator');
    expect(view.checks.find((c) => c.id === 'fetch_blob')?.status).toBe('fail');
    expect(view.checks.find((c) => c.id === 'fetch_blob')?.detail).toBe(
      'holder hint contains an invalid locator',
    );
    expect(fetchFromHoldersCalled).toBe(false);
    expect(fetchBlobCalled).toBe(false);
    expect(view.coin).toBeUndefined();
  });

  it('accepts an @-prefixed http holder URL', async () => {
    const kTx = fill(32, 0x57);
    const { ciphertext, blobId } = zbeSeal(kTx, serializeCoinProof(sampleCoinProof(25)));
    const view = await resolveConfirmationLink(
      {
        status: 'ok',
        kind: 'tx',
        bundle: blobId,
        view: kTx,
        holderHint: '@http://holder.example',
      },
      {
        fetchInfo: async () => ({
          network: 'regtest',
          protocol_version: 'v1',
          finality_confirmations: 6,
          activation_height: 0n,
          max_blob_bytes: 1_048_576n,
          features: [],
        }),
        fetchBlobFromHolders: async (_id, holders) => {
          expect(holders).toEqual(['http://holder.example']);
          return { body: ciphertext, holder: holders[0]! };
        },
        fetchNullifier: async () => ({
          present: false,
          audit_path: [],
          tree_size: 0n,
          root: 'aa'.repeat(32),
          tip_block_hash: 'bb'.repeat(32),
          tip_height: 1n,
        }),
        fetchInscriptions: async () => ({ inscriptions: [] }),
      },
    );
    expect(view.checks.find((c) => c.id === 'fetch_blob')?.detail).toMatch(/holder/);
  });

  it('resolveConfirmationLink early-returns when openConfirmationBlob fails', async () => {
    const sealKey = fill(32, 0x57);
    const wrongKey = fill(32, 0x58);
    const plain = serializeCoinProof(sampleCoinProof(25));
    const { ciphertext, blobId } = zbeSeal(sealKey, plain);
    const view = await resolveConfirmationLink(
      {
        status: 'ok',
        kind: 'tx',
        bundle: blobId,
        view: wrongKey,
      },
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
      },
    );
    expect(view.fatalError).toBeDefined();
    expect(view.coin).toBeUndefined();
    expect(view.state).toBeUndefined();
    expect(view.checks.find((c) => c.id === 'zbe_open')?.status).toBe('fail');
  });

  it('resolveConfirmationLink info failure and blob fetch failure', async () => {
    const kTx = fill(32, 0x55);
    const { ciphertext, blobId } = zbeSeal(kTx, serializeCoinProof(sampleCoinProof(23)));
    const infoFail = await resolveConfirmationLink(
      { status: 'ok', kind: 'tx', bundle: blobId, view: kTx },
      {
        fetchInfo: async () => {
          throw new Error('no info');
        },
      },
    );
    expect(infoFail.fatalError).toMatch(/no info/);

    const blobFail = await resolveConfirmationLink(
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
        fetchBlob: async () => {
          throw new Error('blob gone');
        },
      },
    );
    expect(blobFail.fatalError).toMatch(/blob gone/);
    void ciphertext;
  });

  it('invalid UTF-8 assetTerms name is omitted', async () => {
    const kTx = fill(32, 0x54);
    const { assetIdV1, digestToBytes, GENESIS_TAG } = await import('@zkcoins/sdk');
    const { sha256 } = await import('@/lib/crypto/sha256');
    const creator = xOnlyFromSeed(31);
    const name = new Uint8Array([0x80]); // invalid UTF-8
    const nameHash = sha256(name);
    const assetId = digestToBytes(assetIdV1(GENESIS_TAG, creator, nameHash, 2, 1));
    const cp = sampleCoinProof(22, {
      coin: {
        identifier: digestLabel('id/utf8'),
        recipient: digestLabel('r/utf8'),
        amount: 1n,
        assetId,
      },
      assetTerms: {
        creatorPubkey: creator,
        decimals: 2,
        issuanceVersion: 1,
        name,
      },
    });
    const plain = serializeCoinProof(cp);
    const { ciphertext, blobId } = zbeSeal(kTx, plain);
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
          present: false,
          audit_path: [],
          tree_size: 0n,
          root: 'aa'.repeat(32),
          tip_block_hash: 'bb'.repeat(32),
          tip_height: 1n,
        }),
        fetchInscriptions: async () => ({ inscriptions: [] }),
      },
    );
    expect(view.assetTermsName).toBeUndefined();
  });

  it('findCreatingPkInInscriptions exhausts maxPages without hit', async () => {
    let calls = 0;
    const { pagesScanned, hit } = await findCreatingPkInInscriptions(
      'aa'.repeat(32),
      'bb'.repeat(32),
      async () => {
        calls += 1;
        return {
          inscriptions: [],
          next_height: BigInt(calls),
          next_tx_index: 0,
          next_vin_index: 0,
        };
      },
      { pageLimit: 7, maxPages: 3 },
    );
    expect(pagesScanned).toBe(3);
    expect(hit).toBeUndefined();
    expect(calls).toBe(3);

    for (const partial of [
      { inscriptions: [], next_height: 1n },
      { inscriptions: [], next_height: 1n, next_tx_index: 0 },
    ]) {
      const stopped = await findCreatingPkInInscriptions(
        'aa'.repeat(32),
        'bb'.repeat(32),
        async () => partial,
        { pageLimit: 200, maxPages: 50 },
      );
      expect(stopped.pagesScanned).toBe(1);
    }
  });

  it('uses the production fetchInfo dependency when no override is supplied', async () => {
    const kTx = fill(32, 0x60);
    const { blobId } = zbeSeal(kTx, serializeCoinProof(sampleCoinProof(60)));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      if (String(input).endsWith('/v1/info')) {
        return new Response(
          JSON.stringify({
            network: 'regtest',
            protocol_version: 'v1',
            finality_confirmations: 6,
            activation_height: '0',
            max_blob_bytes: '1048576',
            features: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('', { status: 503 });
    }) as typeof fetch;
    try {
      const view = await resolveConfirmationLink({
        status: 'ok',
        kind: 'tx',
        bundle: blobId,
        view: kTx,
      });
      expect(view.checks.find((c) => c.id === 'node_info')?.status).toBe('pass');
      expect(view.checks.find((c) => c.id === 'fetch_blob')?.status).toBe('fail');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('stringifies non-Error dependency failures', async () => {
    const kTx = fill(32, 0x61);
    const cp = sampleCoinProof(61);
    const { ciphertext, blobId } = zbeSeal(kTx, serializeCoinProof(cp));
    const fragment: TxFragmentOk = { status: 'ok', kind: 'tx', bundle: blobId, view: kTx };
    const info = {
      network: 'regtest' as const,
      protocol_version: 'v1',
      finality_confirmations: 6,
      activation_height: 0n,
      max_blob_bytes: 1_048_576n,
      features: [] as string[],
    };

    const infoFailure = await resolveConfirmationLink(fragment, {
      fetchInfo: async () => {
        throw 'info string failure';
      },
    });
    expect(infoFailure.fatalError).toMatch(/info string failure/);

    const blobFailure = await resolveConfirmationLink(fragment, {
      fetchInfo: async () => info,
      fetchBlob: async () => {
        throw 'blob string failure';
      },
    });
    expect(blobFailure.fatalError).toBe('blob string failure');

    const downstream = await resolveConfirmationLink(fragment, {
      fetchInfo: async () => info,
      fetchBlob: async () => ciphertext,
      fetchNullifier: async () => {
        throw 'nullifier string failure';
      },
      fetchInscriptions: async () => {
        throw 'inscriptions string failure';
      },
    });
    expect(downstream.checks.find((c) => c.id === 'nullifier_path_b')?.detail).toMatch(
      /nullifier string failure/,
    );
    expect(downstream.checks.find((c) => c.id === 'state_310')?.detail).toMatch(
      /inscriptions string failure/,
    );
  });

  it('handles a present nullifier without a leaf and a state hit without tip height', async () => {
    const kTx = fill(32, 0x62);
    const cp = sampleCoinProof(62);
    const { ciphertext, blobId } = zbeSeal(kTx, serializeCoinProof(cp));
    const pkHex = encodeHexLower(cp.creatingNullifier.pkCreate);
    const rHex = encodeHexLower(cp.creatingNullifier.rCreate);
    const common = {
      fetchInfo: async () => ({
        network: 'regtest' as const,
        protocol_version: 'v1',
        finality_confirmations: 6,
        activation_height: 0n,
        max_blob_bytes: 1_048_576n,
        features: [] as string[],
      }),
      fetchBlob: async () => ciphertext,
    };
    const noLeaf = await resolveConfirmationLink(
      { status: 'ok', kind: 'tx', bundle: blobId, view: kTx },
      {
        ...common,
        fetchNullifier: async () => ({
          present: true,
          position: 0n,
          audit_path: [],
          tree_size: 1n,
          root: 'aa'.repeat(32),
          tip_block_hash: 'bb'.repeat(32),
          tip_height: 10n,
        }),
        fetchInscriptions: async () => ({ inscriptions: [] }),
      },
    );
    expect(noLeaf.checks.find((c) => c.id === 'nullifier_path_b')?.status).toBe('fail');
    expect(noLeaf.checks.find((c) => c.id === 'nullifier_r_match')?.status).toBe('fail');
    expect(noLeaf.fatalError).toBeDefined();
    expect(noLeaf.state).toBeUndefined();
    expect(noLeaf.coin).toBeUndefined();
    expect(noLeaf.creatingNullifier).toBeUndefined();
    expect(noLeaf.navOpening).toBeUndefined();
    expect(noLeaf.anchoring?.confirmations).toBeUndefined();

    const matchLeafNoPosition = await resolveConfirmationLink(
      { status: 'ok', kind: 'tx', bundle: blobId, view: kTx },
      {
        ...common,
        fetchNullifier: async () => ({
          present: true,
          leaf: encodeHexLower(cp.creatingNullifier.rCreate),
          audit_path: [],
          tree_size: 1n,
          root: 'aa'.repeat(32),
          tip_block_hash: 'bb'.repeat(32),
          tip_height: 10n,
        }),
        fetchInscriptions: async () => ({ inscriptions: [] }),
      },
    );
    expect(matchLeafNoPosition.checks.find((c) => c.id === 'nullifier_path_b')?.status).toBe(
      'fail',
    );
    expect(matchLeafNoPosition.checks.find((c) => c.id === 'nullifier_r_match')?.status).toBe(
      'fail',
    );
    expect(matchLeafNoPosition.fatalError).toBeDefined();
    expect(matchLeafNoPosition.state).toBeUndefined();
    expect(matchLeafNoPosition.coin).toBeUndefined();
    expect(matchLeafNoPosition.creatingNullifier).toBeUndefined();
    expect(matchLeafNoPosition.navOpening).toBeUndefined();
    expect(matchLeafNoPosition.anchoring?.confirmations).toBeUndefined();

    const hitWithoutTip = await resolveConfirmationLink(
      { status: 'ok', kind: 'tx', bundle: blobId, view: kTx },
      {
        ...common,
        fetchNullifier: async () => {
          throw new Error('lookup unavailable');
        },
        fetchInscriptions: async () => ({
          inscriptions: [
            {
              txid: 'cc'.repeat(32),
              height: 7n,
              tx_index: 0,
              vin_index: 0,
              count: 1,
              format: 1,
              confirmation_state: 'completed' as const,
              nullifiers: [{ pubkey: pkHex, r: rHex, state: 'completed' as const }],
            },
          ],
        }),
      },
    );
    expect(hitWithoutTip.state).toBe('completed');
    expect(hitWithoutTip.anchoring?.confirmations).toBeUndefined();
  });
});
