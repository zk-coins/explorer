/**
 * §5.8 address view — 32/64 B mode selection + mesh production path + scalars.
 */

import { describe, expect, it } from 'vitest';
import {
  buildAddressView,
  decryptIncomingBundle,
  defaultScanMesh,
  openOutgoingWithKtx,
  parseMeshUrls,
  requireSecretScalar,
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

  it('rejects invalid avk directly via buildAddressView catch', () => {
    const frag: AddrFragmentOk = {
      status: 'ok',
      kind: 'addr',
      address: fill(32, 9),
      avk: new Uint8Array(32),
      avkByteLength: 32,
    };
    const view = buildAddressView(frag);
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

describe('§5.8 openOutgoingWithKtx + defaultScanMesh + parseMeshUrls', () => {
  it('requireSecretScalar wrong type/length', () => {
    expect(() => requireSecretScalar(new Uint8Array(16), 'f')).toThrow(/32 bytes/);
    expect(() => requireSecretScalar('x' as unknown as Uint8Array, 'f')).toThrow(/32 bytes/);
  });

  it('openOutgoingWithKtx roundtrip and auth failure', () => {
    const kTx = fill(32, 0x61);
    const cp = sampleCoinProof(30);
    const plain = serializeCoinProof(cp);
    const { ciphertext } = zbeSeal(kTx, plain);
    const opened = openOutgoingWithKtx(kTx, ciphertext);
    expect(opened.coin.amount).toBe(cp.coin.amount);
    expect(() => openOutgoingWithKtx(fill(32, 0x00), ciphertext)).toThrow();
  });

  it('parseMeshUrls branches', () => {
    expect(parseMeshUrls(undefined)).toEqual([]);
    expect(parseMeshUrls('')).toEqual([]);
    expect(parseMeshUrls('@https://r.example/')).toEqual(['https://r.example']);
    expect(parseMeshUrls('@not-http')).toEqual([]);
    expect(parseMeshUrls('https://a.example/,ftp://x,https://b.example')).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
    expect(parseMeshUrls('https://solo.example/')).toEqual(['https://solo.example']);
    expect(parseMeshUrls('garbage')).toEqual([]);
  });

  it('defaultScanMesh empty relays, skips, and accumulates candidates', async () => {
    expect(await defaultScanMesh({ relayUrls: [] })).toEqual([]);

    const epk = xOnlyFromSeed(40);
    const detect = fill(32, 0x11);
    const blobId = fill(32, 0x22);
    const coinId = fill(32, 0x33);

    const candidates = await defaultScanMesh({
      relayUrls: [
        'https://bad.example',
        'https://notok.example',
        'https://nonjson.example',
        'https://nonarray.example',
        'https://good.example',
      ],
      fetchImpl: async (url) => {
        const u = String(url);
        if (u.includes('bad.example')) throw new Error('offline');
        if (u.includes('notok.example')) {
          return { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
        }
        if (u.includes('nonjson.example')) {
          return {
            ok: true,
            json: async () => {
              throw new Error('not json');
            },
          } as unknown as Response;
        }
        if (u.includes('nonarray.example')) {
          return { ok: true, json: async () => ({ not: 'array' }) } as unknown as Response;
        }
        return {
          ok: true,
          json: async () => [
            null,
            { epk: 'zz' }, // malformed hex
            {
              epk: encodeHexLower(epk),
              detect_tag: encodeHexLower(detect),
              blob_id: encodeHexLower(blobId),
              blob_locators: ['https://h.example/', 'ftp://skip', 1],
              side: 'incoming',
            },
            {
              epk: encodeHexLower(epk),
              detect_tag: encodeHexLower(detect),
              blob_id: encodeHexLower(blobId),
              side: 'outgoing',
              coin_id: encodeHexLower(coinId),
            },
            {
              epk: encodeHexLower(epk),
              detect_tag: encodeHexLower(detect),
              blob_id: encodeHexLower(blobId),
              side: 'outgoing',
              // no coin_id
            },
          ],
        } as unknown as Response;
      },
    });
    expect(candidates.length).toBe(3);
    expect(candidates[0]?.side).toBe('incoming');
    expect(candidates[0]?.blobLocators).toEqual(['https://h.example']);
    expect(candidates[1]?.side).toBe('outgoing');
    expect(candidates[1]?.coinId).toEqual(coinId);
    expect(candidates[2]?.side).toBe('outgoing');
    expect(candidates[2]?.coinId).toBeUndefined();
  });
});

describe('§5.8 buildAddressView remaining branches', () => {
  it('incoming recipient mismatch and decrypt throws', () => {
    const ivk = validScalar(5);
    const epk = xOnlyFromSeed(6);
    const address = digestLabel('addr/own');
    const foreign = digestLabel('addr/foreign');
    const cp = sampleCoinProof(40, {
      coin: {
        identifier: digestLabel('id/foreign'),
        recipient: foreign,
        amount: 1n,
        assetId: digestLabel('asset/f'),
      },
      epk,
    });
    const plain = serializeCoinProof(cp);
    const ss = sharedSecretReceiver(ivk, epk);
    const kTx = deriveNoteKey(ss, epk);
    const { ciphertext } = zbeSeal(kTx, plain);
    const frag: AddrFragmentOk = {
      status: 'ok',
      kind: 'addr',
      address,
      avk: ivk,
      avkByteLength: 32,
    };
    const mismatch = buildAddressView(frag, {
      incoming: [{ epk, zbeCiphertext: ciphertext }],
    });
    expect(mismatch.history.some((h) => h.side === 'incoming')).toBe(false);
    expect(mismatch.checks.some((c) => c.status === 'fail' && c.id.startsWith('incoming_'))).toBe(
      true,
    );

    // Decrypt throw: wrong ciphertext.
    const decryptFail = buildAddressView(frag, {
      incoming: [{ epk, zbeCiphertext: new Uint8Array(20) }],
    });
    expect(decryptFail.checks.find((c) => c.id === 'incoming_decrypt')?.status).toBe('fail');
  });

  it('fails k_out_derive when outgoing epk has wrong length', () => {
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
          epk: fill(16, 7),
          // no kTx / zbeCiphertext — deriveOutgoingKey path
        },
      ],
    });
    expect(view.checks.find((c) => c.id === 'k_out_derive')?.status).toBe('fail');
  });

  it('full mode outgoing recovered / fail and noDiscoveries meshScanned', () => {
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
    const kTx = fill(32, 0x71);
    const cp = sampleCoinProof(41);
    const { ciphertext } = zbeSeal(kTx, serializeCoinProof(cp));

    const recovered = buildAddressView(
      frag,
      {
        outgoing: [
          {
            coinId: fill(32, 1),
            blobId: fill(32, 2),
            epk: xOnlyFromSeed(8),
            kTx,
            zbeCiphertext: ciphertext,
          },
        ],
      },
      { meshScanned: true },
    );
    expect(recovered.history.some((h) => h.side === 'outgoing' && h.status === 'recovered')).toBe(
      true,
    );

    const failOpen = buildAddressView(frag, {
      outgoing: [
        {
          coinId: fill(32, 1),
          blobId: fill(32, 2),
          epk: xOnlyFromSeed(8),
          kTx: fill(32, 0x00),
          zbeCiphertext: ciphertext,
        },
      ],
    });
    expect(failOpen.checks.find((c) => c.id === 'outgoing_decrypt')?.status).toBe('fail');

    const emptyMesh = buildAddressView(frag, {}, { meshScanned: true });
    expect(emptyMesh.checks.find((c) => c.id === 'mesh_scan')?.status).toBe('pass');
    expect(emptyMesh.checks.find((c) => c.id === 'outgoing_recovery')?.status).toBe('open');

    // Incoming-only discovery with empty outgoing → outgoing recovery open.
    const ivkOnlyIncoming = buildAddressView(frag, { incoming: [] }, { meshScanned: true });
    // noDiscoveries true with meshScanned
    void ivkOnlyIncoming;

    // Force non-empty incoming side so noDiscoveries is false with empty outgoing.
    const withIncomingOnly = buildAddressView(frag, {
      incoming: [{ epk: xOnlyFromSeed(9), zbeCiphertext: new Uint8Array(8) }],
    });
    expect(withIncomingOnly.checks.find((c) => c.id === 'outgoing_recovery')?.status).toBe('open');
  });
});

describe('§5.8 resolveAddressView remaining branches', () => {
  it('fetchInfo throw continues; canScan false; scanMesh throws', async () => {
    const ivk = validScalar(5);
    const frag: AddrFragmentOk = {
      status: 'ok',
      kind: 'addr',
      address: fill(32, 9),
      avk: ivk,
      avkByteLength: 32,
    };
    // No holder, no scanMesh, fetchInfo throws — continues with empty candidates.
    const noScan = await resolveAddressView(frag, {
      fetchInfo: async () => {
        throw new Error('info down');
      },
    });
    expect(noScan.historyNotResolvable).toBe(true);
    expect(noScan.fatalError).toBeUndefined();

    const scanFail = await resolveAddressView(frag, {
      maxBlobBytes: 1024,
      scanMesh: async () => {
        throw new Error('mesh explode');
      },
    });
    expect(scanFail.fatalError).toMatch(/mesh scan failed/);
    expect(scanFail.checks.find((c) => c.id === 'mesh_scan')?.status).toBe('fail');
  });

  it('sources maxBlobBytes from fetchInfo when deps.maxBlobBytes is omitted', async () => {
    const ivk = validScalar(5);
    const epk = xOnlyFromSeed(6);
    const recipient = digestLabel('recipient/info-max');
    const cp = sampleCoinProof(61, {
      coin: {
        identifier: digestLabel('id/info-max'),
        recipient,
        amount: 7n,
        assetId: digestLabel('asset/info-max'),
      },
      epk,
    });
    const plain = serializeCoinProof(cp);
    const ss = sharedSecretReceiver(ivk, epk);
    const kTx = deriveNoteKey(ss, epk);
    const { ciphertext, blobId } = zbeSeal(kTx, plain);
    const tag = digestToBytes(detectTag(ss, epk));
    const holder = 'https://blossom.info-max.example';
    const frag: AddrFragmentOk = {
      status: 'ok',
      kind: 'addr',
      address: recipient,
      avk: ivk,
      avkByteLength: 32,
      holderHint: `@${holder}`,
    };

    // No explicit maxBlobBytes — success assignment at info.max_blob_bytes must run.
    const view = await resolveAddressView(frag, {
      scanMesh: async () => [
        {
          epk,
          detectTag: tag,
          blobId,
          blobLocators: [holder],
          side: 'incoming',
        },
      ],
      fetchBlobFromHolders: async (_id, _holders, opts) => {
        expect(opts.maxBlobBytes).toBe(1_048_576n);
        return { body: ciphertext, holder };
      },
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
    expect(view.history.some((h) => h.side === 'incoming')).toBe(true);
  });

  it('candidate loop: ciphertext present, empty holders, fetch throws, outgoing push', async () => {
    const ivk = validScalar(5);
    const epk = xOnlyFromSeed(6);
    const badEpk = new Uint8Array(32); // computeDetectTag throws (non-lift)
    const ss = sharedSecretReceiver(ivk, epk);
    const tag = digestToBytes(detectTag(ss, epk));
    const recipient = digestLabel('recipient/loop');
    const cp = sampleCoinProof(50, {
      coin: {
        identifier: digestLabel('id/loop'),
        recipient,
        amount: 9n,
        assetId: digestLabel('asset/loop'),
      },
      epk,
    });
    const kTx = deriveNoteKey(ss, epk);
    const { ciphertext, blobId } = zbeSeal(kTx, serializeCoinProof(cp));

    const frag: AddrFragmentOk = {
      status: 'ok',
      kind: 'addr',
      address: recipient,
      avk: ivk,
      avkByteLength: 32,
    };

    // Incoming with zbeCiphertext already present; bad epk is skipped.
    const pre = await resolveAddressView(frag, {
      maxBlobBytes: 1024,
      scanMesh: async () => [
        {
          epk: badEpk,
          detectTag: tag,
          blobId,
          blobLocators: [],
          side: 'incoming',
        },
        {
          epk,
          detectTag: tag,
          blobId,
          blobLocators: [],
          side: 'incoming',
          zbeCiphertext: ciphertext,
        },
      ],
    });
    expect(pre.history.some((h) => h.side === 'incoming')).toBe(true);

    // Empty holders + no fragment holderHint → skip.
    const noHolders = await resolveAddressView(frag, {
      maxBlobBytes: 1024,
      scanMesh: async () => [
        {
          epk,
          detectTag: tag,
          blobId,
          blobLocators: [],
          side: 'incoming',
        },
      ],
    });
    expect(noHolders.history.some((h) => h.side === 'incoming')).toBe(false);

    // maxBlobBytes undefined after info fail + no deps → skip fetch.
    const noCeil = await resolveAddressView(frag, {
      scanMesh: async () => [
        {
          epk,
          detectTag: tag,
          blobId,
          blobLocators: ['https://h.example'],
          side: 'incoming',
        },
      ],
      fetchInfo: async () => {
        throw new Error('no info');
      },
    });
    expect(noCeil.history.some((h) => h.side === 'incoming')).toBe(false);

    // fetchFromHolders throws → continue.
    const fetchThrow = await resolveAddressView(frag, {
      maxBlobBytes: 1024,
      scanMesh: async () => [
        {
          epk,
          detectTag: tag,
          blobId,
          blobLocators: ['https://h.example'],
          side: 'incoming',
        },
      ],
      fetchBlobFromHolders: async () => {
        throw new Error('holder fail');
      },
    });
    expect(fetchThrow.history.some((h) => h.side === 'incoming')).toBe(false);

    // Outgoing with and without kTx/zbeCiphertext.
    const avk = new Uint8Array(64);
    avk.set(ivk, 0);
    avk.set(validScalar(4), 32);
    const fullFrag: AddrFragmentOk = {
      status: 'ok',
      kind: 'addr',
      address: recipient,
      avk,
      avkByteLength: 64,
    };
    const out = await resolveAddressView(fullFrag, {
      maxBlobBytes: 1024,
      scanMesh: async () => [
        {
          epk,
          detectTag: tag,
          blobId,
          blobLocators: [],
          side: 'outgoing',
          coinId: fill(32, 1),
          kTx,
          zbeCiphertext: ciphertext,
        },
        {
          epk,
          detectTag: tag,
          blobId,
          blobLocators: [],
          side: 'outgoing',
          // no coinId / kTx
        },
      ],
    });
    expect(out.history.some((h) => h.side === 'outgoing' && h.status === 'recovered')).toBe(true);
    expect(out.history.some((h) => h.side === 'outgoing' && h.status === 'unresolved')).toBe(true);
  });
});
