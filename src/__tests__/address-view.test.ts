/**
 * §5.8 address view — 32/64 B mode selection + outgoing not-derivable.
 */

import { describe, expect, it } from 'vitest';
import { buildAddressView, decryptIncomingBundle, selectAvkMode } from '@/lib/bearer/addressView';
import { serializeCoinProof, type CoinProof } from '@/lib/bundle/coinProof';
import { encodeHexLower } from '@/lib/crypto/bytes';
import { sharedSecretReceiver } from '@/lib/crypto/ecdh';
import { deriveNoteKey } from '@/lib/crypto/hkdf';
import { zbeSeal } from '@/lib/crypto/zbe';
import type { AddrFragmentOk } from '@/lib/fragments';
import { schnorr } from '@noble/curves/secp256k1.js';

function fill(n: number, v: number): Uint8Array {
  return Uint8Array.from({ length: n }, () => v);
}

function sampleCoinProof(recipient: Uint8Array): CoinProof {
  return {
    coin: {
      identifier: fill(32, 1),
      recipient,
      amount: 42n,
      assetId: fill(32, 2),
    },
    proof: fill(16, 3),
    inclusionProof: fill(8, 4),
    creatingPrevAsh: fill(32, 5),
    creatingNullifier: {
      pkCreate: fill(32, 6),
      rCreate: fill(32, 7),
      rPrimeCreate: fill(32, 8),
    },
    navOpening: {
      size: 1n,
      mth: fill(32, 9),
      navRand: fill(32, 10),
    },
    epk: fill(32, 0), // overwritten by caller
    ciphertext: fill(16, 11),
    detectTag: fill(32, 12),
  };
}

/** Valid secp256k1 scalar in [1, n) for ECDH tests. */
function validScalar(seed: number): Uint8Array {
  const s = fill(32, seed);
  s[0] = 0x01; // ensure non-zero and < n for small seeds
  return s;
}

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
  });

  it('full mode does not inject not-derivable placeholder', () => {
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
    const view = buildAddressView(frag);
    expect(view.mode).toBe('full');
    expect(view.history.some((h) => h.side === 'outgoing' && h.status === 'not_derivable')).toBe(
      false,
    );
  });

  it('decrypts an incoming ZBE bundle under ivk', () => {
    const ivk = validScalar(5);
    // epk = x-only of a second key
    const esk = validScalar(6);
    const epkPoint = schnorr.Point.BASE.multiply(
      (() => {
        let n = 0n;
        for (const b of esk) n = (n << 8n) | BigInt(b);
        return n;
      })(),
    );
    const epk = epkPoint.toBytes(true).slice(1);

    const recipient = fill(32, 0xaa);
    const cp = sampleCoinProof(recipient);
    cp.epk = epk;
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
  });
});
