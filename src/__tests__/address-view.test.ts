/**
 * §5.8 address view — 32/64 B mode selection + mesh production path + scalars.
 */

import { describe, expect, it } from 'vitest';
import {
  buildAddressView,
  decryptIncomingBundle,
  resolveAddressView,
  selectAvkMode,
} from '@/lib/bearer/addressView';
import { serializeCoinProof } from '@/lib/bundle/coinProof';
import { encodeHexLower } from '@/lib/crypto/bytes';
import { sharedSecretReceiver } from '@/lib/crypto/ecdh';
import { deriveNoteKey } from '@/lib/crypto/hkdf';
import { zbeSeal } from '@/lib/crypto/zbe';
import type { AddrFragmentOk } from '@/lib/fragments';
import { detectTag, digestToBytes } from '@zkcoins/sdk';
import { digestLabel, fill, sampleCoinProof, validScalar, xOnlyFromSeed } from './fixtures/crypto';

describe('§5.8 zkavk mode selection', () => {
  it('selects incoming-only for 32 B payload with valid scalar', () => {
    const ivk = validScalar(1);
    const { mode, ovk } = selectAvkMode(ivk);
    expect(mode).toBe('incoming_only');
    expect(ovk).toBeUndefined();
  });

  it('selects full for 64 B payload with valid scalars', () => {
    const avk = new Uint8Array(64);
    avk.set(validScalar(3), 0);
    avk.set(validScalar(4), 32);
    const { mode, ivk, ovk } = selectAvkMode(avk);
    expect(mode).toBe('full');
    expect(ivk).toEqual(validScalar(3));
    expect(ovk).toEqual(validScalar(4));
  });

  it('rejects other lengths', () => {
    expect(() => selectAvkMode(fill(16, 0))).toThrow(/32 or 64/);
  });

  it('rejects zero and ≥ n scalars on ivk (32 B)', () => {
    expect(() => selectAvkMode(new Uint8Array(32))).toThrow(/not in \[1, n\)/);
    // Fn.ORDER as 32-byte BE is ≥ n.
    const geN = new Uint8Array(32);
    geN.fill(0xff);
    expect(() => selectAvkMode(geN)).toThrow(/not in \[1, n\)/);
  });

  it('rejects invalid ovk on 64 B form', () => {
    const avk = new Uint8Array(64);
    avk.set(validScalar(3), 0);
    // ovk = 0
    expect(() => selectAvkMode(avk)).toThrow(/zkavk\.ovk/);
  });
});

describe('§5.8 address view build', () => {
  it('marks outgoing not-derivable under ivk-only (not empty success)', () => {
    const frag: AddrFragmentOk = {
      status: 'ok',
      kind: 'addr',
      address: fill(32, 9),
      avk: validScalar(1),
      avkByteLength: 32,
    };
    const view = buildAddressView(frag);
    expect(view.mode).toBe('incoming_only');
    const outgoing = view.history.filter((h) => h.side === 'outgoing');
    expect(outgoing.length).toBe(1);
    expect(outgoing[0]).toMatchObject({ status: 'not_derivable' });
    expect(view.checks.find((c) => c.id === 'outgoing_ivk_only')?.status).toBe('pass');
    expect(view.checks.find((c) => c.id === 'mesh_scan')?.status).toBe('open');
    expect(view.historyNotResolvable).toBe(true);
  });

  it('full mode without mesh is not resolvable (not empty history success)', async () => {
    const avk = new Uint8Array(64);
    avk.set(validScalar(3), 0);
    avk.set(validScalar(4), 32);
    const frag: AddrFragmentOk = {
      status: 'ok',
      kind: 'addr',
      address: fill(32, 9),
      avk,
      avkByteLength: 64,
    };
    // Production path: resolveAddressView with no holder / no scan.
    const view = await resolveAddressView(frag);
    expect(view.mode).toBe('full');
    expect(view.historyNotResolvable).toBe(true);
    expect(view.checks.find((c) => c.id === 'mesh_scan')?.status).toBe('open');
    expect(view.history.some((h) => h.side === 'outgoing' && h.status === 'recovered')).toBe(false);
  });

  it('rejects invalid zkavk scalar on production resolve path', async () => {
    const frag: AddrFragmentOk = {
      status: 'ok',
      kind: 'addr',
      address: fill(32, 9),
      avk: new Uint8Array(32), // ivk = 0
      avkByteLength: 32,
    };
    const view = await resolveAddressView(frag);
    expect(view.fatalError).toMatch(/not in \[1, n\)/);
    expect(view.checks.find((c) => c.id === 'avk_mode')?.status).toBe('fail');
  });

  it('marks outgoing without K_tx as unresolved (not recovered)', () => {
    const avk = new Uint8Array(64);
    avk.set(validScalar(3), 0);
    avk.set(validScalar(4), 32);
    const frag: AddrFragmentOk = {
      status: 'ok',
      kind: 'addr',
      address: fill(32, 9),
      avk,
      avkByteLength: 64,
    };
    const view = buildAddressView(frag, {
      outgoing: [
        {
          coinId: fill(32, 1),
          blobId: fill(32, 2),
          epk: xOnlyFromSeed(8),
          // no kTx / zbeCiphertext
        },
      ],
    });
    const out = view.history.filter((h) => h.side === 'outgoing');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ status: 'unresolved' });
    expect(out[0]?.status).not.toBe('recovered');
  });

  it('decrypts an incoming ZBE bundle under ivk via production resolve + mesh mocks', async () => {
    const ivk = validScalar(5);
    const epk = xOnlyFromSeed(6);

    const recipient = digestLabel('recipient/avk-test');
    const cp = sampleCoinProof(7, {
      coin: {
        identifier: digestLabel('id/avk'),
        recipient,
        amount: 42n,
        assetId: digestLabel('asset/avk'),
      },
      epk,
    });
    const plain = serializeCoinProof(cp);
    const ss = sharedSecretReceiver(ivk, epk);
    const kTx = deriveNoteKey(ss, epk);
    const { ciphertext, blobId } = zbeSeal(kTx, plain);
    const tag = digestToBytes(detectTag(ss, epk));

    const holder = 'https://blossom.test.example';
    const frag: AddrFragmentOk = {
      status: 'ok',
      kind: 'addr',
      address: recipient,
      avk: ivk,
      avkByteLength: 32,
      holderHint: `@${holder}`,
    };

    // Production path: resolveAddressView discovers via scanMesh + blob fetch —
    // discoveries are NOT injected into buildAddressView.
    const view = await resolveAddressView(frag, {
      maxBlobBytes: 1_048_576n,
      scanMesh: async () => [
        {
          epk,
          detectTag: tag,
          blobId,
          blobLocators: [holder],
          side: 'incoming',
        },
      ],
      fetchBlobFromHolders: async () => ({ body: ciphertext, holder }),
      fetchInfo: async () => ({
        network: 'regtest',
        protocol_version: 'v1',
        finality_confirmations: 6,
        activation_height: 0n,
        max_blob_bytes: 1_048_576n,
        features: [],
      }),
    });

    expect(view.fatalError).toBeUndefined();
    expect(view.historyNotResolvable).toBeUndefined();
    expect(view.history.some((h) => h.side === 'incoming')).toBe(true);
    const inc = view.history.find((h) => h.side === 'incoming');
    expect(inc && 'coin' in inc ? inc.coin.amount : undefined).toBe('42');
    expect(view.history.some((h) => h.side === 'outgoing' && h.status === 'not_derivable')).toBe(
      true,
    );
    expect(view.checks.find((c) => c.id === 'mesh_scan')?.status).toBe('pass');
  });

  it('does not match candidates whose detect_tag fails ivk recomputation', async () => {
    const ivk = validScalar(5);
    const epk = xOnlyFromSeed(6);
    const frag: AddrFragmentOk = {
      status: 'ok',
      kind: 'addr',
      address: fill(32, 9),
      avk: ivk,
      avkByteLength: 32,
      holderHint: '@https://relay.test.example',
    };
    const view = await resolveAddressView(frag, {
      maxBlobBytes: 1024n,
      scanMesh: async () => [
        {
          epk,
          detectTag: fill(32, 0xab), // wrong tag
          blobId: fill(32, 1),
          blobLocators: ['https://relay.test.example'],
          side: 'incoming',
        },
      ],
      fetchBlobFromHolders: async () => {
        throw new Error('must not fetch on tag mismatch');
      },
    });
    expect(view.history.some((h) => h.side === 'incoming')).toBe(false);
    expect(view.checks.find((c) => c.id === 'mesh_scan')?.status).toBe('pass');
  });
});

describe('§5.8 decrypt helper', () => {
  it('opens a sealed CoinProof under ivk', () => {
    const ivk = validScalar(5);
    const epk = xOnlyFromSeed(6);
    const recipient = digestLabel('recipient/avk-helper');
    const cp = sampleCoinProof(8, {
      coin: {
        identifier: digestLabel('id/avk-h'),
        recipient,
        amount: 7n,
        assetId: digestLabel('asset/avk-h'),
      },
      epk,
    });
    const plain = serializeCoinProof(cp);
    const ss = sharedSecretReceiver(ivk, epk);
    const kTx = deriveNoteKey(ss, epk);
    const { ciphertext } = zbeSeal(kTx, plain);
    const opened = decryptIncomingBundle(ivk, epk, ciphertext);
    expect(opened.coin.amount).toBe(7n);
    expect(encodeHexLower(opened.coin.recipient)).toBe(encodeHexLower(recipient));
  });
});
