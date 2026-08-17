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
import { parseHolderLocators, parseHttpLocator } from '@/lib/bearer/httpLocator';
import { serializeCoinProof } from '@/lib/bundle/coinProof';
import { encodeHexLower } from '@/lib/crypto/bytes';
import { sharedSecretReceiver } from '@/lib/crypto/ecdh';
import { deriveNoteKey } from '@/lib/crypto/hkdf';
import { sha256 } from '@/lib/crypto/sha256';
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
    expect(view.historyGap).toBe('no_scan');
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
    const view = await resolveAddressView(frag, { maxBlobBytes: 1_048_576n });
    expect(view.mode).toBe('full');
    expect(view.historyNotResolvable).toBe(true);
    expect(view.historyGap).toBe('no_scan');
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
    const ss = sharedSecretReceiver(ivk, epk);
    const tag = digestToBytes(detectTag(ss, epk));
    const cp = sampleCoinProof(7, {
      coin: {
        identifier: digestLabel('id/avk'),
        recipient,
        amount: 42n,
        assetId: digestLabel('asset/avk'),
      },
      epk,
      detectTag: tag,
    });
    const plain = serializeCoinProof(cp);
    const kTx = deriveNoteKey(ss, epk);
    const { ciphertext, blobId } = zbeSeal(kTx, plain);

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
      scanMesh: async () => ({
        candidates: [
          {
            epk,
            detectTag: tag,
            blobId,
            blobLocators: [holder],
            side: 'incoming',
          },
        ],
        unresolved: [],
      }),
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
    expect(view.historyGap).toBeUndefined();
    expect(view.history.some((h) => h.side === 'incoming')).toBe(true);
    const inc = view.history.find((h) => h.side === 'incoming');
    expect(inc && 'coin' in inc ? inc.coin.amount : undefined).toBe('42');
    expect(view.history.some((h) => h.side === 'outgoing' && h.status === 'not_derivable')).toBe(
      true,
    );
    expect(view.checks.find((c) => c.id === 'mesh_scan')?.status).toBe('open');
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
      scanMesh: async () => ({
        candidates: [
          {
            epk,
            detectTag: fill(32, 0xab), // wrong tag
            blobId: fill(32, 1),
            blobLocators: ['https://relay.test.example'],
            side: 'incoming',
          },
        ],
        unresolved: [],
      }),
      fetchBlobFromHolders: async () => {
        throw new Error('must not fetch on tag mismatch');
      },
    });
    expect(view.history.some((h) => h.side === 'incoming')).toBe(false);
    expect(view.checks.find((c) => c.id === 'mesh_scan')?.status).toBe('open');
    expect(view.historyNotResolvable).toBe(true);
    expect(view.historyGap).toBe('empty_unverified');
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
    expect(parseMeshUrls('@http://r.example/')).toEqual(['http://r.example']);
    expect(parseMeshUrls('@https://r.example/')).toEqual(['https://r.example']);
    expect(parseMeshUrls('@not-http')).toEqual([]);
    expect(() => parseMeshUrls('http://a.example/,ftp://x,https://b.example')).toThrow(
      /holder hint contains an invalid locator at index 1/,
    );
    expect(() => parseMeshUrls('@https://')).toThrow(/holder hint contains an invalid locator/);
    expect(parseMeshUrls('https://solo.example/')).toEqual(['https://solo.example']);
    expect(parseMeshUrls('garbage')).toEqual([]);
  });

  it('parseHttpLocator and parseHolderLocators fail-closed', () => {
    expect(parseHttpLocator('https://h.example/')).toBe('https://h.example');
    expect(parseHttpLocator('https://')).toBeUndefined();
    expect(parseHttpLocator('ftp://x')).toBeUndefined();
    expect(parseHttpLocator('http://[')).toBeUndefined();

    expect(parseHolderLocators(undefined)).toEqual({ status: 'empty' });
    expect(parseHolderLocators('')).toEqual({ status: 'empty' });
    expect(parseHolderLocators('@https://r.example/')).toEqual({
      status: 'ok',
      locators: ['https://r.example'],
    });
    expect(parseHolderLocators('@https://')).toEqual({
      status: 'invalid',
      detail: 'holder hint contains an invalid locator',
    });
    expect(parseHolderLocators('@not-http')).toEqual({ status: 'empty' });
    expect(parseHolderLocators('@ftp://not-http.example')).toEqual({
      status: 'invalid',
      detail: 'holder hint contains an invalid locator',
    });
    expect(parseHolderLocators('op:pkhex')).toEqual({ status: 'empty' });
    expect(parseHolderLocators('garbage')).toEqual({ status: 'empty' });
    expect(parseHolderLocators('ftp://x')).toEqual({
      status: 'invalid',
      detail: 'holder hint contains an invalid locator',
    });
    expect(parseHolderLocators('http://a.example/,ftp://x,https://b.example')).toEqual({
      status: 'invalid',
      detail: 'holder hint contains an invalid locator at index 1',
    });
    expect(parseHolderLocators(', https://a.example, ,https://b.example,')).toEqual({
      status: 'ok',
      locators: ['https://a.example', 'https://b.example'],
    });
    // Comma-list whose tokens are all empty after trim → empty (not ok, not invalid).
    expect(parseHolderLocators(',,,')).toEqual({ status: 'empty' });
    expect(parseHolderLocators(' , , ')).toEqual({ status: 'empty' });
    expect(parseHolderLocators('https://solo.example/')).toEqual({
      status: 'ok',
      locators: ['https://solo.example'],
    });
    expect(parseHolderLocators('https://')).toEqual({
      status: 'invalid',
      detail: 'holder hint contains an invalid locator',
    });
  });

  it('defaultScanMesh empty relays, skips, and accumulates candidates', async () => {
    expect(await defaultScanMesh({ relayUrls: [] })).toEqual({ candidates: [], unresolved: [] });

    const epk = xOnlyFromSeed(40);
    const detect = fill(32, 0x11);
    const blobId = fill(32, 0x22);
    const coinId = fill(32, 0x33);

    const { candidates, unresolved } = await defaultScanMesh({
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
            42,
            { epk: 'zz' }, // malformed hex
            {
              epk: encodeHexLower(epk),
              detect_tag: encodeHexLower(detect),
              blob_id: encodeHexLower(blobId),
              blob_locators: ['http://h0.example/', 'https://h.example/', 'ftp://skip', 1],
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
    // Incoming with mixed valid/invalid blob_locators is rejected whole (fail-closed).
    expect(candidates.length).toBe(2);
    expect(candidates[0]?.side).toBe('outgoing');
    expect(candidates[0]?.coinId).toEqual(coinId);
    expect(candidates[1]?.side).toBe('outgoing');
    expect(candidates[1]?.coinId).toBeUndefined();
    expect(unresolved).toHaveLength(8);
    expect(
      unresolved.filter((item) => item.reason.includes('malformed delivery-event item')),
    ).toHaveLength(4);
    expect(
      unresolved.some((item) =>
        item.reason.includes(
          'malformed delivery-event item from relay: blob_locators contains an invalid entry at index 2',
        ),
      ),
    ).toBe(true);
    expect(unresolved.some((item) => item.reason.includes('item is not an object'))).toBe(true);
    expect(
      unresolved.some((item) =>
        item.reason.includes('epk/detect_tag/blob_id missing or not a string'),
      ),
    ).toBe(true);
    expect(unresolved.every((u) => u.stage === 'scan')).toBe(true);
  });

  it('defaultScanMesh records outgoing side when coin_id hex is malformed', async () => {
    const epk = encodeHexLower(xOnlyFromSeed(41));
    const detectTag = encodeHexLower(fill(32, 0x44));
    const blobId = encodeHexLower(fill(32, 0x55));

    const { candidates, unresolved } = await defaultScanMesh({
      relayUrls: ['https://outgoing-malformed.example'],
      fetchImpl: async () =>
        ({
          ok: true,
          json: async () => [
            {
              epk,
              detect_tag: detectTag,
              blob_id: blobId,
              side: 'outgoing',
              coin_id: 'zz',
            },
          ],
        }) as unknown as Response,
    });

    expect(candidates).toEqual([]);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]?.side).toBe('outgoing');
    expect(unresolved[0]?.reason).toMatch(/malformed delivery-event/);
    expect(unresolved[0]?.stage).toBe('scan');
  });

  it('defaultScanMesh rejects side: out as unresolved', async () => {
    const epk = encodeHexLower(xOnlyFromSeed(42));
    const detectTag = encodeHexLower(fill(32, 0x46));
    const blobId = encodeHexLower(fill(32, 0x56));

    const { candidates, unresolved } = await defaultScanMesh({
      relayUrls: ['https://side-out.example'],
      fetchImpl: async () =>
        ({
          ok: true,
          json: async () => [
            {
              epk,
              detect_tag: detectTag,
              blob_id: blobId,
              side: 'out',
            },
          ],
        }) as unknown as Response,
    });

    expect(candidates).toEqual([]);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]?.reason).toContain('side must be incoming or outgoing');
    expect(unresolved[0]?.stage).toBe('scan');
  });

  it('defaultScanMesh rejects side: Outgoing as unresolved', async () => {
    const epk = encodeHexLower(xOnlyFromSeed(43));
    const detectTag = encodeHexLower(fill(32, 0x47));
    const blobId = encodeHexLower(fill(32, 0x57));

    const { candidates, unresolved } = await defaultScanMesh({
      relayUrls: ['https://side-Outgoing.example'],
      fetchImpl: async () =>
        ({
          ok: true,
          json: async () => [
            {
              epk,
              detect_tag: detectTag,
              blob_id: blobId,
              side: 'Outgoing',
            },
          ],
        }) as unknown as Response,
    });

    expect(candidates).toEqual([]);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]?.reason).toContain('side must be incoming or outgoing');
    expect(unresolved[0]?.stage).toBe('scan');
  });

  it('defaultScanMesh rejects non-array blob_locators as unresolved', async () => {
    const epk = encodeHexLower(xOnlyFromSeed(44));
    const detectTag = encodeHexLower(fill(32, 0x48));
    const blobId = encodeHexLower(fill(32, 0x58));

    const { candidates, unresolved } = await defaultScanMesh({
      relayUrls: ['https://blob-locators-obj.example'],
      fetchImpl: async () =>
        ({
          ok: true,
          json: async () => [
            {
              epk,
              detect_tag: detectTag,
              blob_id: blobId,
              blob_locators: {},
            },
          ],
        }) as unknown as Response,
    });

    expect(candidates).toEqual([]);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]?.reason).toContain('blob_locators must be an array');
    expect(unresolved[0]?.side).toBe('incoming');
    expect(unresolved[0]?.stage).toBe('scan');
  });

  it('defaultScanMesh non-array blob_locators preserves outgoing side', async () => {
    const epk = encodeHexLower(xOnlyFromSeed(44));
    const detectTag = encodeHexLower(fill(32, 0x48));
    const blobId = encodeHexLower(fill(32, 0x58));

    const { candidates, unresolved } = await defaultScanMesh({
      relayUrls: ['https://blob-locators-obj-out.example'],
      fetchImpl: async () =>
        ({
          ok: true,
          json: async () => [
            {
              epk,
              detect_tag: detectTag,
              blob_id: blobId,
              side: 'outgoing',
              blob_locators: {},
            },
          ],
        }) as unknown as Response,
    });

    expect(candidates).toEqual([]);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]?.side).toBe('outgoing');
    expect(unresolved[0]?.reason).toContain('blob_locators must be an array');
    expect(unresolved[0]?.stage).toBe('scan');
  });

  it('defaultScanMesh rejects https:// without hostname as invalid blob_locator at index 0', async () => {
    const epk = encodeHexLower(xOnlyFromSeed(46));
    const detectTag = encodeHexLower(fill(32, 0x4a));
    const blobId = encodeHexLower(fill(32, 0x5a));

    const { candidates, unresolved } = await defaultScanMesh({
      relayUrls: ['https://blob-locators-bare-https.example'],
      fetchImpl: async () =>
        ({
          ok: true,
          json: async () => [
            {
              epk,
              detect_tag: detectTag,
              blob_id: blobId,
              blob_locators: ['https://'],
            },
          ],
        }) as unknown as Response,
    });

    expect(candidates).toEqual([]);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]?.reason).toContain('invalid entry at index 0');
    expect(unresolved[0]?.stage).toBe('scan');
  });

  it('defaultScanMesh rejects blob_locator that throws in URL constructor as invalid entry at index 0', async () => {
    const epk = encodeHexLower(xOnlyFromSeed(48));
    const detectTag = encodeHexLower(fill(32, 0x4c));
    const blobId = encodeHexLower(fill(32, 0x5c));

    const { candidates, unresolved } = await defaultScanMesh({
      relayUrls: ['https://blob-locators-url-throw.example'],
      fetchImpl: async () =>
        ({
          ok: true,
          json: async () => [
            {
              epk,
              detect_tag: detectTag,
              blob_id: blobId,
              blob_locators: ['http://['],
            },
          ],
        }) as unknown as Response,
    });

    expect(candidates).toEqual([]);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]?.reason).toContain('invalid entry at index 0');
    expect(unresolved[0]?.stage).toBe('scan');
  });

  it('defaultScanMesh rejects whole candidate when first blob_locator is bare https://', async () => {
    const epk = encodeHexLower(xOnlyFromSeed(47));
    const detectTag = encodeHexLower(fill(32, 0x4b));
    const blobId = encodeHexLower(fill(32, 0x5b));

    const { candidates, unresolved } = await defaultScanMesh({
      relayUrls: ['https://blob-locators-mixed-bare-https.example'],
      fetchImpl: async () =>
        ({
          ok: true,
          json: async () => [
            {
              epk,
              detect_tag: detectTag,
              blob_id: blobId,
              blob_locators: ['https://', 'https://good.example'],
            },
          ],
        }) as unknown as Response,
    });

    expect(candidates).toEqual([]);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]?.reason).toContain('invalid entry at index 0');
    expect(unresolved[0]?.stage).toBe('scan');
  });

  it('defaultScanMesh rejects non-string blob_locator at index 0', async () => {
    const epk = encodeHexLower(xOnlyFromSeed(49));
    const detectTag = encodeHexLower(fill(32, 0x4d));
    const blobId = encodeHexLower(fill(32, 0x5d));

    const { candidates, unresolved } = await defaultScanMesh({
      relayUrls: ['https://blob-locators-non-string.example'],
      fetchImpl: async () =>
        ({
          ok: true,
          json: async () => [
            {
              epk,
              detect_tag: detectTag,
              blob_id: blobId,
              blob_locators: [1],
            },
          ],
        }) as unknown as Response,
    });

    expect(candidates).toEqual([]);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]?.reason).toContain(
      'malformed delivery-event item from relay: blob_locators contains an invalid entry at index 0',
    );
    expect(unresolved[0]?.stage).toBe('scan');
  });

  it('defaultScanMesh rejects whole candidate when a later blob_locator is non-string', async () => {
    const epk = encodeHexLower(xOnlyFromSeed(50));
    const detectTag = encodeHexLower(fill(32, 0x4e));
    const blobId = encodeHexLower(fill(32, 0x5e));

    const { candidates, unresolved } = await defaultScanMesh({
      relayUrls: ['https://blob-locators-mixed-non-string.example'],
      fetchImpl: async () =>
        ({
          ok: true,
          json: async () => [
            {
              epk,
              detect_tag: detectTag,
              blob_id: blobId,
              blob_locators: ['https://good.example', 1],
            },
          ],
        }) as unknown as Response,
    });

    // Mixed valid/invalid blob_locators is rejected whole (fail-closed).
    expect(candidates).toEqual([]);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]?.side).toBe('incoming');
    expect(unresolved[0]?.reason).toContain(
      'malformed delivery-event item from relay: blob_locators contains an invalid entry at index 1',
    );
    expect(unresolved[0]?.stage).toBe('scan');
  });

  it('defaultScanMesh invalid blob_locator preserves outgoing side', async () => {
    const epk = encodeHexLower(xOnlyFromSeed(50));
    const detectTag = encodeHexLower(fill(32, 0x4e));
    const blobId = encodeHexLower(fill(32, 0x5e));

    const { candidates, unresolved } = await defaultScanMesh({
      relayUrls: ['https://blob-locators-out-invalid.example'],
      fetchImpl: async () =>
        ({
          ok: true,
          json: async () => [
            {
              epk,
              detect_tag: detectTag,
              blob_id: blobId,
              side: 'outgoing',
              blob_locators: ['https://good.example', 1],
            },
          ],
        }) as unknown as Response,
    });

    expect(candidates).toEqual([]);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]?.side).toBe('outgoing');
    expect(unresolved[0]?.reason).toContain(
      'malformed delivery-event item from relay: blob_locators contains an invalid entry at index 1',
    );
    expect(unresolved[0]?.stage).toBe('scan');
  });

  it('defaultScanMesh defaults missing side and blob_locators', async () => {
    const epk = encodeHexLower(xOnlyFromSeed(45));
    const detectTag = encodeHexLower(fill(32, 0x49));
    const blobId = encodeHexLower(fill(32, 0x59));

    const { candidates, unresolved } = await defaultScanMesh({
      relayUrls: ['https://missing-optional.example'],
      fetchImpl: async () =>
        ({
          ok: true,
          json: async () => [
            {
              epk,
              detect_tag: detectTag,
              blob_id: blobId,
            },
          ],
        }) as unknown as Response,
    });

    expect(unresolved).toEqual([]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.side).toBe('incoming');
    expect(candidates[0]?.blobLocators).toEqual([]);
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
      incoming: [{ epk, zbeCiphertext: ciphertext, blobId: sha256(ciphertext) }],
    });
    expect(mismatch.history.some((h) => h.side === 'incoming')).toBe(false);
    expect(mismatch.checks.some((c) => c.status === 'fail' && c.id.startsWith('incoming_'))).toBe(
      true,
    );
    expect(mismatch.historyNotResolvable).toBe(true);
    // incoming-only adds not_derivable → history.length !== 0 → partial_unresolved
    expect(mismatch.historyGap).toBe('partial_unresolved');

    // Decrypt throw: wrong ciphertext.
    const decryptFail = buildAddressView(frag, {
      incoming: [{ epk, zbeCiphertext: new Uint8Array(20), blobId: fill(32, 0x1a) }],
    });
    expect(decryptFail.checks.find((c) => c.id === 'incoming_decrypt')?.status).toBe('fail');
    expect(decryptFail.historyNotResolvable).toBe(true);
    expect(decryptFail.historyGap).toBe('partial_unresolved');
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

    // Unbound coinId/blobId/epk must not surface as recovered.
    const unbound = buildAddressView(
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
          {
            coinId: fill(32, 3),
            blobId: fill(32, 4),
            epk: xOnlyFromSeed(9),
            kTx,
            // no ciphertext: reaches the second missing-material guard operand
          },
        ],
      },
      { meshScanned: true },
    );
    expect(unbound.history.some((h) => h.side === 'outgoing' && h.status === 'recovered')).toBe(
      false,
    );
    expect(
      unbound.checks.find((c) => c.id === `outgoing_${encodeHexLower(fill(32, 1)).slice(0, 8)}`)
        ?.status,
    ).toBe('fail');
    expect(unbound.history.some((h) => h.side === 'outgoing' && h.status === 'unresolved')).toBe(
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
    expect(failOpen.historyNotResolvable).toBe(true);
    expect(failOpen.history.length).toBe(0);
    expect(failOpen.historyGap).toBe('rejected_candidate');

    const emptyMesh = buildAddressView(frag, {}, { meshScanned: true });
    expect(emptyMesh.checks.find((c) => c.id === 'mesh_scan')?.status).toBe('open');
    expect(emptyMesh.historyNotResolvable).toBe(true);
    expect(emptyMesh.historyGap).toBe('empty_unverified');
    expect(emptyMesh.checks.find((c) => c.id === 'outgoing_recovery')?.status).toBe('open');

    // Incoming-only discovery with empty outgoing → outgoing recovery open.
    const ivkOnlyIncoming = buildAddressView(frag, { incoming: [] }, { meshScanned: true });
    expect(ivkOnlyIncoming.checks.find((c) => c.id === 'outgoing_recovery')?.status).toBe('open');
    expect(ivkOnlyIncoming.historyNotResolvable).toBe(true);
    expect(ivkOnlyIncoming.historyGap).toBe('empty_unverified');

    // Force non-empty incoming side so noDiscoveries is false with empty outgoing.
    const withIncomingOnly = buildAddressView(frag, {
      incoming: [
        {
          epk: xOnlyFromSeed(9),
          zbeCiphertext: new Uint8Array(8),
          blobId: sha256(new Uint8Array(8)),
        },
      ],
    });
    expect(withIncomingOnly.checks.find((c) => c.id === 'outgoing_recovery')?.status).toBe('open');
  });

  it('incoming binding fails on wrong blobId / epk', () => {
    const ivk = validScalar(5);
    const epk = xOnlyFromSeed(6);
    const address = digestLabel('addr/own-bind');
    const frag: AddrFragmentOk = {
      status: 'ok',
      kind: 'addr',
      address,
      avk: ivk,
      avkByteLength: 32,
    };

    // Wrong blobId: recipient matches, epk matches, content-hash fails.
    const cpWrongBlob = sampleCoinProof(50, {
      coin: {
        identifier: digestLabel('id/in-blob'),
        recipient: address,
        amount: 7n,
        assetId: digestLabel('asset/in'),
      },
      epk,
    });
    const plainWrongBlob = serializeCoinProof(cpWrongBlob);
    const ssWrongBlob = sharedSecretReceiver(ivk, epk);
    const kTxWrongBlob = deriveNoteKey(ssWrongBlob, epk);
    const { ciphertext: ctWrongBlob } = zbeSeal(kTxWrongBlob, plainWrongBlob);
    const wrongBlob = buildAddressView(frag, {
      incoming: [{ epk, zbeCiphertext: ctWrongBlob, blobId: fill(32, 0x2a) }],
    });
    expect(wrongBlob.history.some((h) => h.side === 'incoming')).toBe(false);
    expect(
      wrongBlob.checks.find(
        (c) => c.id === `incoming_${encodeHexLower(cpWrongBlob.coin.identifier).slice(0, 8)}`,
      )?.status,
    ).toBe('fail');
    expect(
      wrongBlob.checks.find(
        (c) => c.id === `incoming_${encodeHexLower(cpWrongBlob.coin.identifier).slice(0, 8)}`,
      )?.detail,
    ).toMatch(/blobId/);
    expect(wrongBlob.historyNotResolvable).toBe(true);
    expect(wrongBlob.historyGap).toBe('partial_unresolved');

    // Wrong internal epk: decrypt under candidate epk succeeds; binding rejects.
    const kandidatEpk = xOnlyFromSeed(7);
    const internalEpk = xOnlyFromSeed(99);
    const cpWrongEpk = sampleCoinProof(51, {
      coin: {
        identifier: digestLabel('id/in-epk'),
        recipient: address,
        amount: 8n,
        assetId: digestLabel('asset/in'),
      },
      epk: internalEpk,
    });
    const plainWrongEpk = serializeCoinProof(cpWrongEpk);
    const ssWrongEpk = sharedSecretReceiver(ivk, kandidatEpk);
    const kTxWrongEpk = deriveNoteKey(ssWrongEpk, kandidatEpk);
    const { ciphertext: ctWrongEpk } = zbeSeal(kTxWrongEpk, plainWrongEpk);
    const wrongEpk = buildAddressView(frag, {
      incoming: [{ epk: kandidatEpk, zbeCiphertext: ctWrongEpk, blobId: sha256(ctWrongEpk) }],
    });
    expect(wrongEpk.history.some((h) => h.side === 'incoming')).toBe(false);
    expect(
      wrongEpk.checks.find(
        (c) => c.id === `incoming_${encodeHexLower(cpWrongEpk.coin.identifier).slice(0, 8)}`,
      )?.status,
    ).toBe('fail');
    expect(
      wrongEpk.checks.find(
        (c) => c.id === `incoming_${encodeHexLower(cpWrongEpk.coin.identifier).slice(0, 8)}`,
      )?.detail,
    ).toMatch(/epk/);
    expect(wrongEpk.historyNotResolvable).toBe(true);
    expect(wrongEpk.historyGap).toBe('partial_unresolved');
  });

  it('incoming binding fails on wrong detectTag', () => {
    const ivk = validScalar(5);
    const epk = xOnlyFromSeed(6);
    const address = digestLabel('addr/own-detect');
    const frag: AddrFragmentOk = {
      status: 'ok',
      kind: 'addr',
      address,
      avk: ivk,
      avkByteLength: 32,
    };
    const cpWrongTag = sampleCoinProof(52, {
      coin: {
        identifier: digestLabel('id/in-detect'),
        recipient: address,
        amount: 9n,
        assetId: digestLabel('asset/in'),
      },
      epk,
      detectTag: fill(32, 0xcd),
    });
    const plainWrongTag = serializeCoinProof(cpWrongTag);
    const ssWrongTag = sharedSecretReceiver(ivk, epk);
    const kTxWrongTag = deriveNoteKey(ssWrongTag, epk);
    const { ciphertext: ctWrongTag } = zbeSeal(kTxWrongTag, plainWrongTag);
    const wrongTag = buildAddressView(frag, {
      incoming: [{ epk, zbeCiphertext: ctWrongTag, blobId: sha256(ctWrongTag) }],
    });
    expect(wrongTag.history.some((h) => h.side === 'incoming')).toBe(false);
    expect(
      wrongTag.checks.find(
        (c) => c.id === `incoming_${encodeHexLower(cpWrongTag.coin.identifier).slice(0, 8)}`,
      )?.status,
    ).toBe('fail');
    expect(
      wrongTag.checks.find(
        (c) => c.id === `incoming_${encodeHexLower(cpWrongTag.coin.identifier).slice(0, 8)}`,
      )?.detail,
    ).toMatch(/detectTag/);
    expect(wrongTag.historyNotResolvable).toBe(true);
    expect(wrongTag.historyGap).toBe('partial_unresolved');
  });

  it('outgoing binding fails on wrong blobId / coinId / epk', () => {
    const ivk = validScalar(3);
    const avk = new Uint8Array(64);
    avk.set(ivk, 0);
    avk.set(validScalar(4), 32);
    const frag: AddrFragmentOk = {
      status: 'ok',
      kind: 'addr',
      address: fill(32, 9),
      avk,
      avkByteLength: 64,
    };
    const kTx = fill(32, 0x73);
    const epk = xOnlyFromSeed(43 + 11);
    const ss = sharedSecretReceiver(ivk, epk);
    const tag = digestToBytes(detectTag(ss, epk));
    const cp = sampleCoinProof(43, { detectTag: tag });
    const { ciphertext, blobId } = zbeSeal(kTx, serializeCoinProof(cp));

    const wrongBlob = buildAddressView(frag, {
      outgoing: [
        {
          coinId: cp.coin.identifier,
          blobId: fill(32, 0x2a),
          epk: cp.epk,
          kTx,
          zbeCiphertext: ciphertext,
        },
      ],
    });
    expect(wrongBlob.history.some((h) => h.side === 'outgoing' && h.status === 'recovered')).toBe(
      false,
    );
    expect(
      wrongBlob.checks.find(
        (c) => c.id === `outgoing_${encodeHexLower(cp.coin.identifier).slice(0, 8)}`,
      )?.status,
    ).toBe('fail');
    expect(
      wrongBlob.checks.find(
        (c) => c.id === `outgoing_${encodeHexLower(cp.coin.identifier).slice(0, 8)}`,
      )?.detail,
    ).toMatch(/blobId/);
    expect(wrongBlob.historyNotResolvable).toBe(true);
    expect(wrongBlob.history.length).toBe(0);
    expect(wrongBlob.historyGap).toBe('rejected_candidate');

    const wrongCoinId = buildAddressView(frag, {
      outgoing: [
        {
          coinId: fill(32, 0x2b),
          blobId,
          epk: cp.epk,
          kTx,
          zbeCiphertext: ciphertext,
        },
      ],
    });
    expect(wrongCoinId.history.some((h) => h.side === 'outgoing' && h.status === 'recovered')).toBe(
      false,
    );
    expect(
      wrongCoinId.checks.find(
        (c) => c.id === `outgoing_${encodeHexLower(fill(32, 0x2b)).slice(0, 8)}`,
      )?.status,
    ).toBe('fail');
    expect(
      wrongCoinId.checks.find(
        (c) => c.id === `outgoing_${encodeHexLower(fill(32, 0x2b)).slice(0, 8)}`,
      )?.detail,
    ).toMatch(/coin\.identifier|identifier/);
    expect(wrongCoinId.historyNotResolvable).toBe(true);
    expect(wrongCoinId.history.length).toBe(0);
    expect(wrongCoinId.historyGap).toBe('rejected_candidate');

    const wrongEpk = buildAddressView(frag, {
      outgoing: [
        {
          coinId: cp.coin.identifier,
          blobId,
          epk: xOnlyFromSeed(99),
          kTx,
          zbeCiphertext: ciphertext,
        },
      ],
    });
    expect(wrongEpk.history.some((h) => h.side === 'outgoing' && h.status === 'recovered')).toBe(
      false,
    );
    expect(
      wrongEpk.checks.find(
        (c) => c.id === `outgoing_${encodeHexLower(cp.coin.identifier).slice(0, 8)}`,
      )?.status,
    ).toBe('fail');
    expect(
      wrongEpk.checks.find(
        (c) => c.id === `outgoing_${encodeHexLower(cp.coin.identifier).slice(0, 8)}`,
      )?.detail,
    ).toMatch(/epk/);
    expect(wrongEpk.historyNotResolvable).toBe(true);
    expect(wrongEpk.history.length).toBe(0);
    expect(wrongEpk.historyGap).toBe('rejected_candidate');

    // Bound success path.
    const ok = buildAddressView(frag, {
      outgoing: [
        {
          coinId: cp.coin.identifier,
          blobId,
          epk: cp.epk,
          kTx,
          zbeCiphertext: ciphertext,
        },
      ],
    });
    expect(ok.history.some((h) => h.side === 'outgoing' && h.status === 'recovered')).toBe(true);
    expect(
      ok.checks.find((c) => c.id === `outgoing_${encodeHexLower(cp.coin.identifier).slice(0, 8)}`)
        ?.status,
    ).toBe('pass');
  });

  it('outgoing binding fails on wrong detectTag', () => {
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
    const kTx = fill(32, 0x74);
    const cp = sampleCoinProof(43, {
      detectTag: fill(32, 0xcd),
    });
    const { ciphertext } = zbeSeal(kTx, serializeCoinProof(cp));
    const wrongTag = buildAddressView(frag, {
      outgoing: [
        {
          coinId: cp.coin.identifier,
          blobId: sha256(ciphertext),
          epk: cp.epk,
          kTx,
          zbeCiphertext: ciphertext,
        },
      ],
    });
    expect(wrongTag.history.some((h) => h.side === 'outgoing' && h.status === 'recovered')).toBe(
      false,
    );
    expect(
      wrongTag.checks.find(
        (c) => c.id === `outgoing_${encodeHexLower(cp.coin.identifier).slice(0, 8)}`,
      )?.status,
    ).toBe('fail');
    expect(
      wrongTag.checks.find(
        (c) => c.id === `outgoing_${encodeHexLower(cp.coin.identifier).slice(0, 8)}`,
      )?.detail,
    ).toMatch(/detectTag/);
    expect(wrongTag.historyNotResolvable).toBe(true);
    expect(wrongTag.history.length).toBe(0);
    expect(wrongTag.historyGap).toBe('rejected_candidate');
  });

  it('fails mesh scan and marks rejected_candidate when binding fails and unresolved remain (empty history)', () => {
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
    const kTx = fill(32, 0x72);
    const cp = sampleCoinProof(42);
    const { ciphertext } = zbeSeal(kTx, serializeCoinProof(cp));

    const view = buildAddressView(
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
      {
        meshScanned: true,
        unresolvedCandidates: [
          {
            side: 'outgoing',
            epkHex: encodeHexLower(xOnlyFromSeed(9)),
            blobIdHex: encodeHexLower(fill(32, 3)),
            reason: 'delivery event is missing coin_id',
            stage: 'matched_candidate',
          },
        ],
      },
    );

    // Unbound outgoing is not recovered; binding reject + empty history beats partial_unresolved.
    expect(view.history.some((h) => h.side === 'outgoing' && h.status === 'recovered')).toBe(false);
    expect(view.checks.find((c) => c.id === 'mesh_scan')?.status).toBe('fail');
    expect(view.historyNotResolvable).toBe(true);
    expect(view.historyGap).toBe('rejected_candidate');
    const unresolvedCheck = view.checks.find((c) => c.id.startsWith('mesh_unresolved_'));
    expect(unresolvedCheck?.label).toBe(
      'Delivery candidate matched detect_tag but could not be resolved',
    );
  });
});

describe('§5.8 resolveAddressView remaining branches', () => {
  it('mesh_unresolved_* check ids stay unique when a scan-level and a candidate-level entry share an epk prefix (no duplicate React key)', async () => {
    const badEpk = new Uint8Array(32);
    const frag: AddrFragmentOk = {
      status: 'ok',
      kind: 'addr',
      address: fill(32, 9),
      avk: validScalar(5),
      avkByteLength: 32,
    };
    const view = await resolveAddressView(frag, {
      maxBlobBytes: 1024,
      scanMesh: async () => ({
        candidates: [
          {
            epk: badEpk,
            detectTag: fill(32, 1),
            blobId: fill(32, 2),
            blobLocators: [],
            side: 'incoming',
          },
        ],
        unresolved: [
          {
            side: 'incoming',
            epkHex: encodeHexLower(badEpk),
            blobIdHex: '',
            reason: 'relay produced no usable candidate list',
            stage: 'scan',
          },
        ],
      }),
    });

    const ids = view.checks.filter((c) => c.id.startsWith('mesh_unresolved_')).map((c) => c.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(ids.length);
    expect(view.checks.find((c) => c.id === 'mesh_scan')?.status).toBe('fail');
    expect(view.historyNotResolvable).toBe(true);
    expect(view.historyGap).toBe('partial_unresolved');
    // Both entries are scan-level (scanMesh unresolved + computeDetectTag fail before match).
    const unresolvedLabels = view.checks
      .filter((c) => c.id.startsWith('mesh_unresolved_'))
      .map((c) => c.label);
    expect(
      unresolvedLabels.every((l) => l === 'Mesh scan could not produce a usable candidate'),
    ).toBe(true);
  });

  it('fetchInfo throw continues; canScan false; scanMesh throws', async () => {
    const ivk = validScalar(5);
    const frag: AddrFragmentOk = {
      status: 'ok',
      kind: 'addr',
      address: fill(32, 9),
      avk: ivk,
      avkByteLength: 32,
    };
    // No holder, no scanMesh, fetchInfo throws — continues with empty candidates
    // but surfaces the fetchInfo error as a visible node_info fail check (B1).
    const noScan = await resolveAddressView(frag, {
      fetchInfo: async () => {
        throw new Error('info down');
      },
    });
    expect(noScan.historyNotResolvable).toBe(true);
    expect(noScan.historyGap).toBe('no_scan');
    expect(noScan.fatalError).toBeUndefined();
    expect(noScan.checks.find((c) => c.id === 'node_info')?.status).toBe('fail');

    const scanFail = await resolveAddressView(frag, {
      maxBlobBytes: 1024,
      scanMesh: async () => {
        throw new Error('mesh explode');
      },
    });
    expect(scanFail.fatalError).toMatch(/mesh scan failed/);
    expect(scanFail.checks.find((c) => c.id === 'mesh_scan')?.status).toBe('fail');
    expect(scanFail.historyNotResolvable).toBe(true);
    expect(scanFail.historyGap).toBe('no_scan');
  });

  it('invalid holderHint fails closed before scanMesh', async () => {
    const ivk = validScalar(5);
    const frag: AddrFragmentOk = {
      status: 'ok',
      kind: 'addr',
      address: fill(32, 9),
      avk: ivk,
      avkByteLength: 32,
      holderHint: 'https://a.example,ftp://x',
    };
    let scanCalled = false;
    const view = await resolveAddressView(frag, {
      maxBlobBytes: 1024,
      scanMesh: async () => {
        scanCalled = true;
        return { candidates: [], unresolved: [] };
      },
    });
    expect(scanCalled).toBe(false);
    expect(view.fatalError).toMatch(/mesh scan failed/);
    expect(view.checks.find((c) => c.id === 'mesh_scan')?.status).toBe('fail');
    expect(view.checks.find((c) => c.id === 'mesh_scan')?.detail).toMatch(
      /holder hint contains an invalid locator at index 1/,
    );
    expect(view.history).toEqual([]);
    expect(view.historyNotResolvable).toBe(true);
    expect(view.historyGap).toBe('no_scan');
  });

  it('sources maxBlobBytes from fetchInfo when deps.maxBlobBytes is omitted', async () => {
    const ivk = validScalar(5);
    const epk = xOnlyFromSeed(6);
    const recipient = digestLabel('recipient/info-max');
    const ss = sharedSecretReceiver(ivk, epk);
    const tag = digestToBytes(detectTag(ss, epk));
    const cp = sampleCoinProof(61, {
      coin: {
        identifier: digestLabel('id/info-max'),
        recipient,
        amount: 7n,
        assetId: digestLabel('asset/info-max'),
      },
      epk,
      detectTag: tag,
    });
    const plain = serializeCoinProof(cp);
    const kTx = deriveNoteKey(ss, epk);
    const { ciphertext, blobId } = zbeSeal(kTx, plain);
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
      scanMesh: async () => ({
        candidates: [
          {
            epk,
            detectTag: tag,
            blobId,
            blobLocators: [holder],
            side: 'incoming',
          },
        ],
        unresolved: [],
      }),
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

  it('uses the production fetchInfo dependency only through a global fetch stub', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      expect(String(input)).toMatch(/\/v1\/info$/);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          network: 'regtest',
          protocol_version: 'v1',
          finality_confirmations: 6,
          activation_height: '0',
          max_blob_bytes: '1048576',
          features: [],
        }),
      } as unknown as Response;
    }) as typeof fetch;
    try {
      const view = await resolveAddressView({
        status: 'ok',
        kind: 'addr',
        address: fill(32, 9),
        avk: validScalar(5),
        avkByteLength: 32,
      });
      expect(view.checks.find((c) => c.id === 'node_info')).toBeUndefined();
      expect(view.historyNotResolvable).toBe(true);
      expect(view.historyGap).toBe('no_scan');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('candidate loop: malformed epk, ciphertext, holders, fetch failure, and outgoing paths', async () => {
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
      detectTag: tag,
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

    // Incoming with zbeCiphertext already present; bad epk becomes unresolved.
    const pre = await resolveAddressView(frag, {
      maxBlobBytes: 1024,
      scanMesh: async () => ({
        candidates: [
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
        unresolved: [],
      }),
    });
    expect(pre.history.some((h) => h.side === 'incoming')).toBe(true);
    expect(
      pre.checks.some((c) => c.id.startsWith('mesh_unresolved_incoming_') && c.status === 'fail'),
    ).toBe(true);
    expect(pre.checks.find((c) => c.id === 'mesh_scan')?.status).not.toBe('pass');
    expect(pre.historyGap).toBe('partial_unresolved');
    expect(pre.checks.find((c) => c.id.startsWith('mesh_unresolved_incoming_'))?.label).toBe(
      'Mesh scan could not produce a usable candidate',
    );

    // Empty holders + no fragment holderHint → skip.
    const noHolders = await resolveAddressView(frag, {
      maxBlobBytes: 1024,
      scanMesh: async () => ({
        candidates: [
          {
            epk,
            detectTag: tag,
            blobId,
            blobLocators: [],
            side: 'incoming',
          },
        ],
        unresolved: [],
      }),
    });
    expect(noHolders.history.some((h) => h.side === 'incoming')).toBe(false);
    expect(noHolders.historyGap).toBe('partial_unresolved');
    expect(noHolders.checks.find((c) => c.id.startsWith('mesh_unresolved_incoming_'))?.label).toBe(
      'Delivery candidate matched detect_tag but could not be resolved',
    );

    // maxBlobBytes undefined after info fail + no deps → skip fetch.
    const noCeil = await resolveAddressView(frag, {
      scanMesh: async () => ({
        candidates: [
          {
            epk,
            detectTag: tag,
            blobId,
            blobLocators: ['https://h.example'],
            side: 'incoming',
          },
        ],
        unresolved: [],
      }),
      fetchInfo: async () => {
        throw new Error('no info');
      },
    });
    expect(noCeil.history.some((h) => h.side === 'incoming')).toBe(false);
    expect(noCeil.checks.find((c) => c.id.startsWith('mesh_unresolved_incoming_'))?.label).toBe(
      'Delivery candidate matched detect_tag but could not be resolved',
    );

    // fetchFromHolders throws → continue.
    const fetchThrow = await resolveAddressView(frag, {
      maxBlobBytes: 1024,
      scanMesh: async () => ({
        candidates: [
          {
            epk,
            detectTag: tag,
            blobId,
            blobLocators: ['https://h.example'],
            side: 'incoming',
          },
        ],
        unresolved: [],
      }),
      fetchBlobFromHolders: async () => {
        throw new Error('holder fail');
      },
    });
    expect(fetchThrow.history.some((h) => h.side === 'incoming')).toBe(false);
    expect(fetchThrow.checks.find((c) => c.id.startsWith('mesh_unresolved_incoming_'))?.label).toBe(
      'Delivery candidate matched detect_tag but could not be resolved',
    );

    // Outgoing: recovered (bound kTx+ciphertext), unresolved (coinId known, no kTx),
    // and B4 missing-coin_id (never invents all-zero id — only mesh_unresolved fail).
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
      scanMesh: async () => ({
        candidates: [
          {
            epk: cp.epk,
            detectTag: tag,
            blobId,
            blobLocators: [],
            side: 'outgoing',
            coinId: cp.coin.identifier,
            kTx,
            zbeCiphertext: ciphertext,
          },
          {
            epk,
            detectTag: tag,
            blobId,
            blobLocators: [],
            side: 'outgoing',
            coinId: fill(32, 3),
            // coin_id known; no kTx/zbeCiphertext → genuine unresolved path
          },
          {
            epk,
            detectTag: tag,
            blobId,
            blobLocators: [],
            side: 'outgoing',
            // no coinId / kTx — B4: must not invent all-zero coinId
          },
        ],
        unresolved: [],
      }),
    });
    expect(out.history.some((h) => h.side === 'outgoing' && h.status === 'recovered')).toBe(true);
    expect(out.history.some((h) => h.side === 'outgoing' && h.status === 'unresolved')).toBe(true);
    expect(
      out.checks.some((c) => c.id.startsWith('mesh_unresolved_outgoing_') && c.status === 'fail'),
    ).toBe(true);
    expect(out.checks.find((c) => c.id.startsWith('mesh_unresolved_outgoing_'))?.label).toBe(
      'Delivery candidate matched detect_tag but could not be resolved',
    );
    expect(out.historyGap).toBe('partial_unresolved');
    const allZeroHex = encodeHexLower(new Uint8Array(32));
    expect(out.history.every((h) => !('coinIdHex' in h) || h.coinIdHex !== allZeroHex)).toBe(true);
  });

  it('B2: matched detect_tag but blob fetch throws → mesh_unresolved fail, not clean pass', async () => {
    const ivk = validScalar(5);
    const epk = xOnlyFromSeed(6);
    const ss = sharedSecretReceiver(ivk, epk);
    const tag = digestToBytes(detectTag(ss, epk));
    const blobId = fill(32, 0xab);
    const frag: AddrFragmentOk = {
      status: 'ok',
      kind: 'addr',
      address: fill(32, 9),
      avk: ivk,
      avkByteLength: 32,
    };
    const view = await resolveAddressView(frag, {
      maxBlobBytes: 1024,
      scanMesh: async () => ({
        candidates: [
          {
            epk,
            detectTag: tag,
            blobId,
            blobLocators: ['https://h.example'],
            side: 'incoming',
          },
        ],
        unresolved: [],
      }),
      fetchBlobFromHolders: async () => {
        throw new Error('holder fail');
      },
    });
    expect(view.history.some((h) => h.side === 'incoming')).toBe(false);
    expect(
      view.checks.some((c) => c.id.startsWith('mesh_unresolved_incoming_') && c.status === 'fail'),
    ).toBe(true);
    expect(view.historyNotResolvable).toBe(true);
    expect(view.historyGap).toBe('partial_unresolved');
    expect(view.checks.find((c) => c.id === 'mesh_scan')?.status).toBe('fail');
    expect(view.checks.find((c) => c.id.startsWith('mesh_unresolved_incoming_'))?.label).toBe(
      'Delivery candidate matched detect_tag but could not be resolved',
    );
  });

  it('incoming empty blobLocators: holderHint invalid only after mesh scan → unresolved, no blob fetch', async () => {
    // holderHint is read twice in resolveAddressView: once for relayUrls (must not throw)
    // and once when resolving holders for an incoming candidate without blobLocators.
    // A static invalid hint hits the early abort; a getter delivers a non-throwing value first.
    const ivk = validScalar(5);
    const epk = xOnlyFromSeed(6);
    const ss = sharedSecretReceiver(ivk, epk);
    const tag = digestToBytes(detectTag(ss, epk));
    const blobId = fill(32, 0xab);
    let holderHintReads = 0;
    const frag: AddrFragmentOk = {
      status: 'ok',
      kind: 'addr',
      address: fill(32, 9),
      avk: ivk,
      avkByteLength: 32,
      get holderHint() {
        holderHintReads += 1;
        if (holderHintReads === 1) {
          return undefined;
        }
        return 'http://a.example/,ftp://x';
      },
    };
    let fetchCalled = false;
    const view = await resolveAddressView(frag, {
      maxBlobBytes: 1024,
      scanMesh: async () => ({
        candidates: [
          {
            epk,
            detectTag: tag,
            blobId,
            blobLocators: [],
            side: 'incoming',
          },
        ],
        unresolved: [],
      }),
      fetchBlobFromHolders: async () => {
        fetchCalled = true;
        throw new Error('fetchBlobFromHolders must not be called');
      },
    });
    expect(view.history.some((h) => h.side === 'incoming')).toBe(false);
    const unresolved = view.checks.find(
      (c) => c.id.startsWith('mesh_unresolved_incoming_') && c.status === 'fail',
    );
    expect(unresolved).toBeDefined();
    expect(unresolved?.detail).toMatch(/holder hint contains an invalid locator at index 1/);
    expect(unresolved?.label).toBe(
      'Delivery candidate matched detect_tag but could not be resolved',
    );
    expect(view.historyNotResolvable).toBe(true);
    expect(view.historyGap).toBe('partial_unresolved');
    expect(view.checks.find((c) => c.id === 'mesh_scan')?.status).toBe('fail');
    expect(view.fatalError).toBeUndefined();
    expect(fetchCalled).toBe(false);
  });

  it('B3: all relays unreachable → fatalError mesh_scan fail (never pass)', async () => {
    const ivk = validScalar(5);
    const frag: AddrFragmentOk = {
      status: 'ok',
      kind: 'addr',
      address: fill(32, 9),
      avk: ivk,
      avkByteLength: 32,
      holderHint: 'https://relay-a.example,https://relay-b.example',
    };
    // No deps.scanMesh → defaultScanMesh; every relay fetch throws.
    const view = await resolveAddressView(frag, {
      maxBlobBytes: 1024,
      fetchImpl: async () => {
        throw new Error('relay down');
      },
    });
    expect(view.fatalError).toBeDefined();
    expect(view.checks.find((c) => c.id === 'mesh_scan')?.status).toBe('fail');
    expect(view.checks.find((c) => c.id === 'mesh_scan')?.status).not.toBe('pass');
  });

  it('F1: partial relay outage (one failed, one empty) → mesh_scan fail, not a clean pass', async () => {
    const frag: AddrFragmentOk = {
      status: 'ok',
      kind: 'addr',
      address: fill(32, 9),
      avk: validScalar(5),
      avkByteLength: 32,
      holderHint: 'https://relay-a.example,https://relay-b.example',
    };
    const view = await resolveAddressView(frag, {
      maxBlobBytes: 1024,
      fetchImpl: async (url) => {
        if (String(url).includes('relay-a.example')) {
          return { ok: false, status: 503 } as unknown as Response;
        }
        return { ok: true, json: async () => [] } as unknown as Response;
      },
    });

    expect(view.checks.find((c) => c.id === 'mesh_scan')?.status).toBe('fail');
    expect(view.historyNotResolvable).toBe(true);
    expect(view.historyGap).toBe('partial_unresolved');
    expect(view.fatalError).toBeUndefined();
    expect(view.checks.find((c) => c.id.startsWith('mesh_unresolved_'))?.label).toBe(
      'Mesh scan could not produce a usable candidate',
    );
  });

  it('F2: malformed item alongside a valid one → scan marked incomplete despite one resolved candidate', async () => {
    const ivk = validScalar(5);
    const epk = xOnlyFromSeed(6);
    const recipient = digestLabel('recipient/f2');
    const ss = sharedSecretReceiver(ivk, epk);
    const tag = digestToBytes(detectTag(ss, epk));
    const cp = sampleCoinProof(62, {
      coin: {
        identifier: digestLabel('id/f2'),
        recipient,
        amount: 11n,
        assetId: digestLabel('asset/f2'),
      },
      epk,
      detectTag: tag,
    });
    const kTx = deriveNoteKey(ss, epk);
    const { ciphertext, blobId } = zbeSeal(kTx, serializeCoinProof(cp));
    const relay = 'https://relay-f2.example';
    const frag: AddrFragmentOk = {
      status: 'ok',
      kind: 'addr',
      address: recipient,
      avk: ivk,
      avkByteLength: 32,
      holderHint: relay,
    };
    const view = await resolveAddressView(frag, {
      maxBlobBytes: 1_048_576n,
      fetchImpl: async () =>
        ({
          ok: true,
          json: async () => [
            {
              epk: encodeHexLower(epk),
              detect_tag: encodeHexLower(tag),
              blob_id: encodeHexLower(blobId),
              blob_locators: [relay],
              side: 'incoming',
            },
            {
              epk: 'zz',
              detect_tag: encodeHexLower(tag),
              blob_id: encodeHexLower(blobId),
              side: 'incoming',
            },
          ],
        }) as unknown as Response,
      fetchBlobFromHolders: async () => ({ body: ciphertext, holder: relay }),
    });

    expect(view.checks.find((c) => c.id === 'mesh_scan')?.status).toBe('fail');
    expect(view.historyNotResolvable).toBe(true);
    expect(view.historyGap).toBe('partial_unresolved');
    expect(view.history.some((h) => h.side === 'incoming')).toBe(true);
    expect(view.checks.find((c) => c.id.startsWith('mesh_unresolved_'))?.label).toBe(
      'Mesh scan could not produce a usable candidate',
    );
  });

  it('B1: fetchInfo throw + matched candidate needing blob → node_info + mesh_unresolved, no hard abort', async () => {
    const ivk = validScalar(5);
    const epk = xOnlyFromSeed(6);
    const ss = sharedSecretReceiver(ivk, epk);
    const tag = digestToBytes(detectTag(ss, epk));
    const blobId = fill(32, 0xcd);
    const frag: AddrFragmentOk = {
      status: 'ok',
      kind: 'addr',
      address: fill(32, 9),
      avk: ivk,
      avkByteLength: 32,
    };
    const view = await resolveAddressView(frag, {
      // no maxBlobBytes — forces fetchInfo
      scanMesh: async () => ({
        candidates: [
          {
            epk,
            detectTag: tag,
            blobId,
            blobLocators: ['https://h.example'],
            side: 'incoming',
          },
        ],
        unresolved: [],
      }),
      fetchInfo: async () => {
        throw new Error('info endpoint down');
      },
    });
    expect(view.fatalError).toBeUndefined();
    expect(view.checks.find((c) => c.id === 'node_info')?.status).toBe('fail');
    const unresolved = view.checks.find(
      (c) => c.id.startsWith('mesh_unresolved_incoming_') && c.status === 'fail',
    );
    expect(unresolved).toBeDefined();
    expect(unresolved?.detail).toMatch(/info endpoint down/);
    expect(unresolved?.label).toBe(
      'Delivery candidate matched detect_tag but could not be resolved',
    );
    expect(view.historyNotResolvable).toBe(true);
    expect(view.historyGap).toBe('partial_unresolved');
  });

  it('preserves node_info failure when mesh scan also fails', async () => {
    const frag: AddrFragmentOk = {
      status: 'ok',
      kind: 'addr',
      address: fill(32, 9),
      avk: validScalar(5),
      avkByteLength: 32,
    };
    const view = await resolveAddressView(frag, {
      fetchInfo: async () => {
        throw new Error('info endpoint down');
      },
      scanMesh: async () => {
        throw new Error('mesh endpoint down');
      },
    });

    expect(view.checks.find((c) => c.id === 'node_info')?.status).toBe('fail');
    expect(view.checks.find((c) => c.id === 'mesh_scan')?.status).toBe('fail');
    expect(view.checks.map((c) => c.id)).toEqual(['node_info', 'mesh_scan']);
  });
});

describe('§5.8 defaultScanMesh total outage', () => {
  it('B3: throws when every relay is unreachable', async () => {
    await expect(
      defaultScanMesh({
        relayUrls: ['https://a.example', 'https://b.example'],
        fetchImpl: async () => {
          throw new Error('down');
        },
      }),
    ).rejects.toThrow(/unreachable/);
  });

  it('throws when every relay returns an unusable response', async () => {
    await expect(
      defaultScanMesh({
        relayUrls: [
          'https://status.example',
          'https://nonjson.example',
          'https://nonarray.example',
        ],
        fetchImpl: async (url) => {
          const u = String(url);
          if (u.includes('status.example')) {
            return { ok: false, status: 503 } as unknown as Response;
          }
          if (u.includes('nonjson.example')) {
            return {
              ok: true,
              json: async () => {
                throw new Error('invalid JSON');
              },
            } as unknown as Response;
          }
          return { ok: true, json: async () => ({ candidates: [] }) } as unknown as Response;
        },
      }),
    ).rejects.toThrow(/all 3 relay\(s\) unreachable: .*HTTP 503.*invalid JSON.*non-array response/);
  });

  it('uses global fetch and reports non-Error transport and JSON failures', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      ({ ok: true, json: async () => [] }) as Response) as typeof fetch;
    try {
      await expect(defaultScanMesh({ relayUrls: ['https://global.example'] })).resolves.toEqual({
        candidates: [],
        unresolved: [],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    await expect(
      defaultScanMesh({
        relayUrls: ['https://string-throw.example'],
        fetchImpl: async () => {
          throw 'transport string failure';
        },
      }),
    ).rejects.toThrow(/transport string failure/);

    await expect(
      defaultScanMesh({
        relayUrls: ['https://json-string.example'],
        fetchImpl: async () =>
          ({
            ok: true,
            json: async () => {
              throw 'json string failure';
            },
          }) as unknown as Response,
      }),
    ).rejects.toThrow(/json string failure/);
  });

  it('records each missing mesh field and stringifies a hostile field conversion', async () => {
    const epkHex = encodeHexLower(xOnlyFromSeed(70));
    const tagHex = encodeHexLower(fill(32, 0x11));
    const blobHex = encodeHexLower(fill(32, 0x22));
    const result = await defaultScanMesh({
      relayUrls: ['https://malformed.example'],
      fetchImpl: async () =>
        ({
          ok: true,
          json: async () => [
            { detect_tag: tagHex, blob_id: blobHex },
            { epk: epkHex, blob_id: blobHex },
            { epk: epkHex, detect_tag: tagHex },
            { epk: 'zz', side: 'outgoing' },
            {
              epk: {
                toString: () => {
                  throw 'field conversion string failure';
                },
              },
            },
          ],
        }) as unknown as Response,
    });
    expect(result.candidates).toEqual([]);
    expect(result.unresolved).toHaveLength(5);
    expect(
      result.unresolved.every((u) =>
        u.reason.includes('epk/detect_tag/blob_id missing or not a string'),
      ),
    ).toBe(true);
    expect(result.unresolved.every((u) => u.side === 'incoming')).toBe(true);
    expect(result.unresolved.every((u) => u.stage === 'scan')).toBe(true);
  });
});

describe('§5.8 non-Error fallbacks and AVK invariants', () => {
  const baseFragment = (): AddrFragmentOk => ({
    status: 'ok',
    kind: 'addr',
    address: fill(32, 9),
    avk: validScalar(5),
    avkByteLength: 32,
  });

  it('stringifies AVK access failures and preserves the declared fallback mode', async () => {
    const hostileAvk = {
      get length() {
        throw 'avk length string failure';
      },
    } as unknown as Uint8Array;
    const incoming = buildAddressView({ ...baseFragment(), avk: hostileAvk });
    expect(incoming.mode).toBe('incoming_only');
    expect(incoming.fatalError).toBe('avk length string failure');

    const resolved = await resolveAddressView({ ...baseFragment(), avk: hostileAvk });
    expect(resolved.mode).toBe('incoming_only');
    expect(resolved.fatalError).toBe('avk length string failure');

    const invalidFull = new Uint8Array(64);
    invalidFull.set(validScalar(3));
    const full = buildAddressView({ ...baseFragment(), avk: invalidFull, avkByteLength: 64 });
    expect(full.mode).toBe('full');
    expect(full.fatalError).toMatch(/zkavk\.ovk/);

    const resolvedFull = await resolveAddressView({
      ...baseFragment(),
      avk: invalidFull,
      avkByteLength: 64,
    });
    expect(resolvedFull.mode).toBe('full');
    expect(resolvedFull.fatalError).toMatch(/zkavk\.ovk/);
  });

  it('labels incoming ECDH failures and stringifies dependency rejections', async () => {
    const ecdh = buildAddressView(baseFragment(), {
      incoming: [{ epk: fill(16, 1), zbeCiphertext: new Uint8Array(8), blobId: fill(32, 0x1b) }],
    });
    expect(ecdh.checks.find((c) => c.id === 'incoming_decrypt')?.detail).toMatch(/EcdhError/);

    const ivk = validScalar(5);
    const epk = xOnlyFromSeed(72);
    const ss = sharedSecretReceiver(ivk, epk);
    const kTx = deriveNoteKey(ss, epk);
    const invalidProof = zbeSeal(kTx, new Uint8Array([1, 2, 3])).ciphertext;
    const coinProof = buildAddressView(
      { ...baseFragment(), avk: ivk },
      { incoming: [{ epk, zbeCiphertext: invalidProof, blobId: sha256(invalidProof) }] },
    );
    expect(coinProof.checks.find((c) => c.id === 'incoming_decrypt')?.detail).toMatch(/CoinProof/);

    const infoFailure = await resolveAddressView(baseFragment(), {
      fetchInfo: async () => {
        throw 'info string failure';
      },
    });
    expect(infoFailure.checks.find((c) => c.id === 'node_info')?.detail).toBe(
      'info string failure',
    );

    const scanFailure = await resolveAddressView(baseFragment(), {
      maxBlobBytes: 1024,
      scanMesh: async () => {
        throw 'scan string failure';
      },
    });
    expect(scanFailure.fatalError).toMatch(/scan string failure/);
  });

  it('classifies an outgoing malformed epk and stringifies blob fetch rejection', async () => {
    const ivk = validScalar(5);
    const epk = xOnlyFromSeed(71);
    const ss = sharedSecretReceiver(ivk, epk);
    const tag = digestToBytes(detectTag(ss, epk));
    const blobId = fill(32, 0x44);
    const outgoingBad = await resolveAddressView(baseFragment(), {
      maxBlobBytes: 1024,
      scanMesh: async () => ({
        candidates: [
          {
            epk: new Uint8Array(32),
            detectTag: fill(32, 1),
            blobId,
            blobLocators: [],
            side: 'outgoing',
          },
        ],
        unresolved: [],
      }),
    });
    expect(outgoingBad.checks.some((c) => c.id.startsWith('mesh_unresolved_outgoing_'))).toBe(true);
    expect(
      outgoingBad.checks.find((c) => c.id.startsWith('mesh_unresolved_outgoing_'))?.label,
    ).toBe('Mesh scan could not produce a usable candidate');
    expect(outgoingBad.historyGap).toBe('partial_unresolved');

    const fetchFailure = await resolveAddressView(
      { ...baseFragment(), avk: ivk },
      {
        maxBlobBytes: 1024,
        scanMesh: async () => ({
          candidates: [
            {
              epk,
              detectTag: tag,
              blobId,
              blobLocators: ['https://holder.example'],
              side: 'incoming',
            },
          ],
          unresolved: [],
        }),
        fetchBlobFromHolders: async () => {
          throw 'blob string failure';
        },
      },
    );
    expect(fetchFailure.checks.some((c) => c.detail.includes('blob string failure'))).toBe(true);
    expect(
      fetchFailure.checks.find((c) => c.id.startsWith('mesh_unresolved_incoming_'))?.label,
    ).toBe('Delivery candidate matched detect_tag but could not be resolved');
    expect(fetchFailure.historyGap).toBe('partial_unresolved');
  });
});
