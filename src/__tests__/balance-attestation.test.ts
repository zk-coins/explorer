/**
 * §5.7 balance attestation decode + checklist honesty + fail-closed info.
 */

import { describe, expect, it } from 'vitest';
import {
  BalanceAttestationError,
  deserializeBalanceAttestationV1,
  serializeBalanceAttestationV1,
  type BalanceAttestationV1,
} from '@/lib/bundle/balanceAttestation';
import { resolveBalanceAttestation, verifyBalanceAttestationBytes } from '@/lib/bearer/balance';
import { base64UrlEncodeNoPad, encodeHexLower, writeU32Be } from '@/lib/crypto/bytes';
import { sha256 } from '@/lib/crypto/sha256';
import type { BalanceFragmentOk } from '@/lib/fragments';
import { digestToBytes, networkIdRegtest, networkIdTestnet } from '@zkcoins/sdk';

function fill(n: number, v: number): Uint8Array {
  return Uint8Array.from({ length: n }, () => v);
}

function sampleAttestation(): BalanceAttestationV1 {
  return {
    subject: fill(32, 0x11),
    assetId: fill(32, 0x22),
    balance: 9_000n,
    navCeiling: fill(32, 0x33),
    sizeCeiling: 100n,
    txid: fill(32, 0x44),
    blockHash: fill(32, 0x55),
    height: 800_000n,
    pkAnchor: fill(32, 0x66),
    rAnchor: fill(32, 0x77),
    networkId: digestToBytes(networkIdRegtest()),
    proof: fill(80, 0x88),
  };
}

function fragmentFor(att: BalanceAttestationV1): BalanceFragmentOk {
  return {
    status: 'ok',
    kind: 'balance',
    address: att.subject.slice(),
    assetIdHex: encodeHexLower(att.assetId),
    attestationForm: 'inline',
    attestationInline: base64UrlEncodeNoPad(serializeBalanceAttestationV1(att)),
  };
}

describe('§5.7 balance attestation', () => {
  it('decodes and matches subject/asset/network; proof/nav/anchor are open', () => {
    const att = sampleAttestation();
    const body = serializeBalanceAttestationV1(att);
    const frag = fragmentFor(att);

    const view = verifyBalanceAttestationBytes(body, frag, { network: 'regtest' });
    expect(view.fatalError).toBeUndefined();
    expect(view.fields?.balance).toBe('9000');
    expect(view.fields?.subjectHex).toBe(encodeHexLower(att.subject));

    const byId = Object.fromEntries(view.checks.map((c) => [c.id, c]));
    expect(byId['decode']?.status).toBe('pass');
    expect(byId['subject_match']?.status).toBe('pass');
    expect(byId['asset_match']?.status).toBe('pass');
    expect(byId['network_id']?.status).toBe('pass');
    // Honest open steps — never claimed verified:
    expect(byId['c_balance_proof']?.status).toBe('open');
    expect(byId['nav_ceiling_canonical']?.status).toBe('open');
    expect(byId['anchor_first_occurrence']?.status).toBe('open');
  });

  it('fails subject mismatch', () => {
    const att = sampleAttestation();
    const body = serializeBalanceAttestationV1(att);
    const frag = fragmentFor(att);
    frag.address = fill(32, 0x99);

    const view = verifyBalanceAttestationBytes(body, frag, { network: 'regtest' });
    expect(view.checks.find((c) => c.id === 'subject_match')?.status).toBe('fail');
    expect(view.fatalError).toBeDefined();
    expect(view.fields).toBeUndefined();
    expect(view.checks.every((c) => !c.detail.includes('9000'))).toBe(true);
  });

  it('fails handle hash mismatch', () => {
    const att = sampleAttestation();
    const body = serializeBalanceAttestationV1(att);
    const wrongHandle = sha256(new Uint8Array([1, 2, 3]));
    const frag = fragmentFor(att);
    frag.attestationForm = 'handle';
    frag.attestationHandle = wrongHandle;

    const view = verifyBalanceAttestationBytes(body, frag, {
      network: 'regtest',
      expectedHandle: wrongHandle,
    });
    expect(view.checks.find((c) => c.id === 'handle_hash')?.status).toBe('fail');
    expect(view.fatalError).toMatch(/handle mismatch/);
  });

  it('passes handle hash when body matches zkatt payload', () => {
    const att = sampleAttestation();
    const body = serializeBalanceAttestationV1(att);
    const handle = sha256(body);
    const frag = fragmentFor(att);
    frag.attestationForm = 'handle';
    frag.attestationHandle = handle;

    const view = verifyBalanceAttestationBytes(body, frag, {
      network: 'regtest',
      expectedHandle: handle,
    });
    expect(view.checks.find((c) => c.id === 'handle_hash')?.status).toBe('pass');
  });

  it('propagates /v1/info failure fail-closed (does not open network_id quietly)', async () => {
    const att = sampleAttestation();
    const frag = fragmentFor(att);
    const view = await resolveBalanceAttestation(frag, {
      fetchInfo: async () => {
        throw new Error('info endpoint down');
      },
    });
    expect(view.fatalError).toMatch(/info endpoint down/);
    expect(view.checks.find((c) => c.id === 'node_info')?.status).toBe('fail');
    // Must not have silently left network_id as open without aborting:
    expect(view.fields).toBeUndefined();
  });

  it('rejects inline body larger than max_blob_bytes before decoding', async () => {
    const att = sampleAttestation();
    const frag = fragmentFor(att);
    // Instrument atob: if the size gate works, decode never runs.
    const originalAtob = globalThis.atob;
    let atobCalls = 0;
    globalThis.atob = ((data: string) => {
      atobCalls += 1;
      return originalAtob(data);
    }) as typeof atob;
    try {
      const view = await resolveBalanceAttestation(frag, {
        network: 'regtest',
        maxBlobBytes: 16,
      });
      expect(view.fatalError).toMatch(/max_blob_bytes|exceeds max/);
      expect(view.checks.find((c) => c.id === 'obtain')?.status).toBe('fail');
      expect(atobCalls).toBe(0);
    } finally {
      globalThis.atob = originalAtob;
    }
  });

  it('deserializeBalanceAttestationV1 rejects non-bytes, short, bad proof len, trailing', () => {
    expect(() => deserializeBalanceAttestationV1('x' as unknown as Uint8Array)).toThrow(
      BalanceAttestationError,
    );
    expect(() => deserializeBalanceAttestationV1(new Uint8Array(10))).toThrow(/too short/);
    const att = sampleAttestation();
    const body = serializeBalanceAttestationV1(att);
    // proof length prefix at offset 288; set to huge value.
    const badLen = body.slice();
    badLen.set(writeU32Be(0xffff_ffff), 288);
    expect(() => deserializeBalanceAttestationV1(badLen)).toThrow(/exceeds remaining/);
    const trailing = new Uint8Array(body.length + 1);
    trailing.set(body);
    expect(() => deserializeBalanceAttestationV1(trailing)).toThrow(/trailing bytes/);
  });

  it('fails asset_match on mismatch', () => {
    const att = sampleAttestation();
    const body = serializeBalanceAttestationV1(att);
    const frag = fragmentFor(att);
    frag.assetIdHex = 'ff'.repeat(32);
    const view = verifyBalanceAttestationBytes(body, frag, { network: 'regtest' });
    expect(view.checks.find((c) => c.id === 'asset_match')?.status).toBe('fail');
    expect(view.fatalError).toBeDefined();
    expect(view.fields).toBeUndefined();
  });

  it('network_id mismatch and pure helper without network', () => {
    const att = sampleAttestation();
    const body = serializeBalanceAttestationV1(att);
    const frag = fragmentFor(att);
    const mismatch = verifyBalanceAttestationBytes(body, frag, { network: 'mainnet' });
    expect(mismatch.checks.find((c) => c.id === 'network_id')?.status).toBe('fail');
    const openNet = verifyBalanceAttestationBytes(body, frag);
    expect(openNet.checks.find((c) => c.id === 'network_id')?.status).toBe('open');
  });

  it('matches the testnet network id', () => {
    const att = sampleAttestation();
    att.networkId = digestToBytes(networkIdTestnet());
    const view = verifyBalanceAttestationBytes(
      serializeBalanceAttestationV1(att),
      fragmentFor(att),
      { network: 'testnet' },
    );
    expect(view.checks.find((c) => c.id === 'network_id')?.status).toBe('pass');
  });

  it('serializes empty proof', () => {
    const att = sampleAttestation();
    att.proof = new Uint8Array(0);
    const body = serializeBalanceAttestationV1(att);
    const again = deserializeBalanceAttestationV1(body);
    expect(again.proof.length).toBe(0);
  });

  it('decode-throws branch on verifyBalanceAttestationBytes', () => {
    const att = sampleAttestation();
    const frag = fragmentFor(att);
    const view = verifyBalanceAttestationBytes(new Uint8Array(8), frag, { network: 'regtest' });
    expect(view.checks.find((c) => c.id === 'decode')?.status).toBe('fail');
    expect(view.fatalError).toBeDefined();
  });

  it('resolveBalanceAttestation skips info when network+maxBlobBytes supplied', async () => {
    const att = sampleAttestation();
    const frag = fragmentFor(att);
    let infoCalls = 0;
    const view = await resolveBalanceAttestation(frag, {
      network: 'regtest',
      maxBlobBytes: 1_000_000,
      fetchInfo: async () => {
        infoCalls += 1;
        throw new Error('should not call');
      },
      fetchNullifier: async () => ({
        present: true,
        position: 1n,
        leaf: 'aa'.repeat(32),
        audit_path: [],
        tree_size: 1n,
        root: 'bb'.repeat(32),
        tip_block_hash: 'cc'.repeat(32),
        tip_height: 10n,
      }),
    });
    expect(infoCalls).toBe(0);
    expect(view.fields?.balance).toBe('9000');
    expect(view.checks.find((c) => c.id === 'anchor_path_b')?.status).toBe('pass');
  });

  it('fetchInfo fills only the missing of network / maxBlobBytes', async () => {
    const att = sampleAttestation();
    const frag = fragmentFor(att);
    const info = {
      network: 'regtest' as const,
      protocol_version: 'v1',
      finality_confirmations: 6,
      activation_height: 0n,
      max_blob_bytes: 1_000_000n,
      features: [] as string[],
    };

    // (a) network supplied, maxBlobBytes sourced from fetchInfo.
    const onlyNetwork = await resolveBalanceAttestation(frag, {
      network: 'regtest',
      fetchInfo: async () => info,
      fetchNullifier: async () => ({
        present: true,
        position: 1n,
        leaf: 'aa'.repeat(32),
        audit_path: [],
        tree_size: 1n,
        root: 'bb'.repeat(32),
        tip_block_hash: 'cc'.repeat(32),
        tip_height: 10n,
      }),
    });
    expect(onlyNetwork.fatalError).toBeUndefined();
    expect(onlyNetwork.fields?.balance).toBe('9000');
    expect(onlyNetwork.checks.find((c) => c.id === 'network_id')?.status).toBe('pass');

    // (b) maxBlobBytes supplied, network sourced from fetchInfo.
    const onlyMax = await resolveBalanceAttestation(frag, {
      maxBlobBytes: 1_000_000n,
      fetchInfo: async () => info,
      fetchNullifier: async () => ({
        present: true,
        position: 1n,
        leaf: 'aa'.repeat(32),
        audit_path: [],
        tree_size: 1n,
        root: 'bb'.repeat(32),
        tip_block_hash: 'cc'.repeat(32),
        tip_height: 10n,
      }),
    });
    expect(onlyMax.fatalError).toBeUndefined();
    expect(onlyMax.fields?.balance).toBe('9000');
    expect(onlyMax.checks.find((c) => c.id === 'network_id')?.status).toBe('pass');
  });

  it('Path-B probe present:false and lookup failed', async () => {
    const att = sampleAttestation();
    const frag = fragmentFor(att);
    const absent = await resolveBalanceAttestation(frag, {
      network: 'regtest',
      maxBlobBytes: 1_000_000,
      fetchNullifier: async () => ({
        present: false,
        audit_path: [],
        tree_size: 1n,
        root: 'bb'.repeat(32),
        tip_block_hash: 'cc'.repeat(32),
        tip_height: 10n,
      }),
    });
    expect(absent.checks.find((c) => c.id === 'anchor_path_b')?.status).toBe('open');

    const failed = await resolveBalanceAttestation(frag, {
      network: 'regtest',
      maxBlobBytes: 1_000_000,
      fetchNullifier: async () => {
        throw new Error('nf down');
      },
    });
    expect(failed.checks.find((c) => c.id === 'anchor_path_b')?.detail).toMatch(/nf down/);

    const nonError = await resolveBalanceAttestation(frag, {
      network: 'regtest',
      maxBlobBytes: 1_000_000,
      fetchNullifier: async () => {
        throw 'nf string failure';
      },
    });
    expect(nonError.checks.find((c) => c.id === 'anchor_path_b')?.detail).toMatch(
      /nf string failure/,
    );
  });

  it('stringifies non-Error info and holder failures', async () => {
    const att = sampleAttestation();
    const inline = await resolveBalanceAttestation(fragmentFor(att), {
      fetchInfo: async () => {
        throw 'info string failure';
      },
    });
    expect(inline.fatalError).toMatch(/info string failure/);

    const body = serializeBalanceAttestationV1(att);
    const handle = sha256(body);
    const holder = await resolveBalanceAttestation(
      {
        status: 'ok',
        kind: 'balance',
        address: att.subject.slice(),
        assetIdHex: encodeHexLower(att.assetId),
        attestationForm: 'handle',
        attestationHandle: handle,
        holderHint: 'https://holder.example',
      },
      {
        network: 'regtest',
        maxBlobBytes: 1_000_000,
        fetchFromHolders: async () => {
          throw 'holder string failure';
        },
      },
    );
    expect(holder.fatalError).toBe('holder string failure');
  });

  it('handle form: missing handle, no holders, holders fetch fail, comma holderHint', async () => {
    const att = sampleAttestation();
    const body = serializeBalanceAttestationV1(att);
    const handle = sha256(body);

    const missing = await resolveBalanceAttestation(
      {
        status: 'ok',
        kind: 'balance',
        address: att.subject.slice(),
        assetIdHex: encodeHexLower(att.assetId),
        attestationForm: 'handle',
      },
      { network: 'regtest', maxBlobBytes: 1_000_000 },
    );
    expect(missing.fatalError).toMatch(/handle missing/);

    const noHolders = await resolveBalanceAttestation(
      {
        status: 'ok',
        kind: 'balance',
        address: att.subject.slice(),
        assetIdHex: encodeHexLower(att.assetId),
        attestationForm: 'handle',
        attestationHandle: handle,
      },
      { network: 'regtest', maxBlobBytes: 1_000_000 },
    );
    expect(noHolders.fatalError).toMatch(/BlobLocatorSet/);

    const fetchFail = await resolveBalanceAttestation(
      {
        status: 'ok',
        kind: 'balance',
        address: att.subject.slice(),
        assetIdHex: encodeHexLower(att.assetId),
        attestationForm: 'handle',
        attestationHandle: handle,
        holderHint: 'https://a.example, https://b.example',
      },
      {
        network: 'regtest',
        maxBlobBytes: 1_000_000,
        fetchFromHolders: async () => {
          throw new Error('holders down');
        },
      },
    );
    expect(fetchFail.fatalError).toMatch(/holders down/);

    const ok = await resolveBalanceAttestation(
      {
        status: 'ok',
        kind: 'balance',
        address: att.subject.slice(),
        assetIdHex: encodeHexLower(att.assetId),
        attestationForm: 'handle',
        attestationHandle: handle,
        holderHint: ', https://a.example, ,https://b.example,',
      },
      {
        network: 'regtest',
        maxBlobBytes: 1_000_000,
        fetchFromHolders: async (_handle, holders) => {
          expect(holders).toEqual(['https://a.example', 'https://b.example']);
          return { body, holder: 'https://a.example' };
        },
        fetchNullifier: async () => ({
          present: false,
          audit_path: [],
          tree_size: 1n,
          root: 'bb'.repeat(32),
          tip_block_hash: 'cc'.repeat(32),
          tip_height: 10n,
        }),
      },
    );
    expect(ok.fields?.balance).toBe('9000');
  });

  it('inline empty body and decode error on resolve', async () => {
    const att = sampleAttestation();
    const missing = await resolveBalanceAttestation(
      {
        status: 'ok',
        kind: 'balance',
        address: att.subject.slice(),
        assetIdHex: encodeHexLower(att.assetId),
        attestationForm: 'inline',
      },
      { network: 'regtest', maxBlobBytes: 1_000_000 },
    );
    expect(missing.fatalError).toMatch(/inline.*missing/);

    const empty = await resolveBalanceAttestation(
      {
        status: 'ok',
        kind: 'balance',
        address: att.subject.slice(),
        assetIdHex: encodeHexLower(att.assetId),
        attestationForm: 'inline',
        attestationInline: '',
      },
      { network: 'regtest', maxBlobBytes: 1_000_000 },
    );
    expect(empty.fatalError).toMatch(/inline.*missing/);

    const badB64 = await resolveBalanceAttestation(
      {
        status: 'ok',
        kind: 'balance',
        address: att.subject.slice(),
        assetIdHex: encodeHexLower(att.assetId),
        attestationForm: 'inline',
        attestationInline: '!!!',
      },
      { network: 'regtest', maxBlobBytes: 1_000_000 },
    );
    expect(badB64.checks.find((c) => c.id === 'obtain')?.status).toBe('fail');
  });

  it('uses default dependencies only through a fully stubbed info request', async () => {
    const att = sampleAttestation();
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
      const view = await resolveBalanceAttestation({
        ...fragmentFor(att),
        attestationInline: '!!!',
      });
      expect(view.checks.find((c) => c.id === 'obtain')?.status).toBe('fail');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('stringifies a non-Error base64 decoder failure', async () => {
    const att = sampleAttestation();
    const originalAtob = globalThis.atob;
    globalThis.atob = (() => {
      throw 'atob string failure';
    }) as typeof atob;
    try {
      const view = await resolveBalanceAttestation(fragmentFor(att), {
        network: 'regtest',
        maxBlobBytes: 1_000_000,
      });
      expect(view.fatalError).toBe('base64url: decode failed');
      expect(view.checks.find((c) => c.id === 'obtain')?.status).toBe('fail');
    } finally {
      globalThis.atob = originalAtob;
    }
  });

  it('stringifies a non-Error inline size-gate failure', async () => {
    const att = sampleAttestation();
    const hostileLimit = {
      [Symbol.toPrimitive]() {
        throw 'max bytes string failure';
      },
    } as unknown as number;

    const view = await resolveBalanceAttestation(fragmentFor(att), {
      network: 'regtest',
      maxBlobBytes: hostileLimit,
    });

    expect(view.fatalError).toBe('max bytes string failure');
    expect(view.checks.find((c) => c.id === 'obtain')?.detail).toBe('max bytes string failure');
  });
});
