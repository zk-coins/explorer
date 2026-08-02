/**
 * §5.8 address view — 32/64 B mode selection + outgoing not-derivable / unresolved.
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
import { digestLabel, fill, sampleCoinProof, validScalar, xOnlyFromSeed } from './fixtures/crypto';

describe('§5.8 zkavk mode selection', () => {
  it('selects incoming-only for 32 B payload', () => {
    const { mode, ivk, ovk } = selectAvkMode(fill(32, 1));
    expect(mode).toBe('incoming_only');
    expect(ivk.length).toBe(32);
    expect(ovk).toBeUndefined();
  });

  it('selects full for 64 B payload', () => {
    const avk = new Uint8Array(64);
    avk.set(fill(32, 1), 0);
    avk.set(fill(32, 2), 32);
    const { mode, ivk, ovk } = selectAvkMode(avk);
    expect(mode).toBe('full');
    expect(ivk).toEqual(fill(32, 1));
    expect(ovk).toEqual(fill(32, 2));
  });

  it('rejects other lengths', () => {
    expect(() => selectAvkMode(fill(16, 0))).toThrow(/32 or 64/);
  });
});

describe('§5.8 address view build', () => {
  it('marks outgoing not-derivable under ivk-only (not empty success)', () => {
    const frag: AddrFragmentOk = {
      status: 'ok',
      kind: 'addr',
      address: fill(32, 9),
      avk: fill(32, 1),
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

  it('full mode without discoveries is not resolvable (not empty history success)', async () => {
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
    // Production path: resolveAddressView with no discoveries.
    const view = await resolveAddressView(frag);
    expect(view.mode).toBe('full');
    expect(view.historyNotResolvable).toBe(true);
    expect(view.checks.find((c) => c.id === 'mesh_scan')?.status).toBe('open');
    expect(view.history.some((h) => h.side === 'outgoing' && h.status === 'recovered')).toBe(false);
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

  it('decrypts an incoming ZBE bundle under ivk', () => {
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

    // Seal under K_tx derived the same way the receiver will.
    const ss = sharedSecretReceiver(ivk, epk);
    const kTx = deriveNoteKey(ss, epk);
    const { ciphertext } = zbeSeal(kTx, plain);

    const opened = decryptIncomingBundle(ivk, epk, ciphertext);
    expect(opened.coin.amount).toBe(42n);
    expect(encodeHexLower(opened.coin.recipient)).toBe(encodeHexLower(recipient));

    const frag: AddrFragmentOk = {
      status: 'ok',
      kind: 'addr',
      address: recipient,
      avk: ivk,
      avkByteLength: 32,
    };
    const view = buildAddressView(frag, {
      incoming: [{ epk, zbeCiphertext: ciphertext }],
    });
    expect(view.history.some((h) => h.side === 'incoming')).toBe(true);
    expect(view.history.some((h) => h.side === 'outgoing' && h.status === 'not_derivable')).toBe(
      true,
    );
    expect(view.historyNotResolvable).toBeUndefined();
  });
});
