import { describe, expect, it, vi, afterEach } from 'vitest';
import { encodeBech32m, EXPLORER_HRPS } from '@/lib/bech32m';
import {
  parseAddrFragment,
  parseBalanceFragment,
  parseTxFragment,
  readLocationHash,
} from '@/lib/fragments';

function p(n: number, fill: number): Uint8Array {
  return Uint8Array.from({ length: n }, () => fill);
}

describe('fragment parsing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses a valid tx fragment (zkbid/zkview)', () => {
    const bundle = encodeBech32m(EXPLORER_HRPS.zkbid, p(32, 1));
    const view = encodeBech32m(EXPLORER_HRPS.zkview, p(32, 2));
    const result = parseTxFragment(`#${bundle}/${view}`);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.bundle.length).toBe(32);
      expect(result.view.length).toBe(32);
    }
  });

  it('parses tx fragment with holder hint', () => {
    const bundle = encodeBech32m(EXPLORER_HRPS.zkbid, p(32, 1));
    const view = encodeBech32m(EXPLORER_HRPS.zkview, p(32, 2));
    const result = parseTxFragment(
      `#${bundle}/${view};h=${encodeURIComponent('https://h.example')}`,
    );
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.holderHint).toBe('https://h.example');
    }
  });

  it('rejects empty and invalid holder hint encoding', () => {
    const bundle = encodeBech32m(EXPLORER_HRPS.zkbid, p(32, 1));
    const view = encodeBech32m(EXPLORER_HRPS.zkview, p(32, 2));
    expect(parseTxFragment(`#${bundle}/${view};h=`).status).toBe('error');
    // Lone % is invalid percent-encoding.
    expect(parseTxFragment(`#${bundle}/${view};h=%`).status).toBe('error');
  });

  it('rejects swapped HRPs on tx fragment', () => {
    const wrongBundle = encodeBech32m(EXPLORER_HRPS.zkview, p(32, 1));
    const wrongView = encodeBech32m(EXPLORER_HRPS.zkbid, p(32, 2));
    const result = parseTxFragment(`#${wrongBundle}/${wrongView}`);
    expect(result.status).toBe('error');
  });

  it('rejects wrong part count and empty parts on tx', () => {
    expect(parseTxFragment('#onlyone').status).toBe('error');
    expect(parseTxFragment('#a/b/c').status).toBe('error');
    expect(parseTxFragment('#/viewonly').status).toBe('error');
    expect(parseTxFragment('#bundleonly/').status).toBe('error');
  });

  it('parses a valid addr fragment (zk/zkavk 64 B → full mode)', () => {
    const address = encodeBech32m(EXPLORER_HRPS.zk, p(32, 3));
    const avk = encodeBech32m(EXPLORER_HRPS.zkavk, p(64, 4));
    const result = parseAddrFragment(`#${address}/${avk}`);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.avkByteLength).toBe(64);
    }
  });

  it('parses zkavk 32 B → incoming-only mode with holder hint', () => {
    const address = encodeBech32m(EXPLORER_HRPS.zk, p(32, 3));
    const avk = encodeBech32m(EXPLORER_HRPS.zkavk, p(32, 4));
    const result = parseAddrFragment(
      `#${address}/${avk};h=${encodeURIComponent('https://relay.example')}`,
    );
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.avkByteLength).toBe(32);
      expect(result.holderHint).toBe('https://relay.example');
    }
  });

  it('rejects wrong HRP and part counts on addr fragment', () => {
    const address = encodeBech32m(EXPLORER_HRPS.zk, p(32, 3));
    const notAvk = encodeBech32m(EXPLORER_HRPS.zkview, p(32, 4));
    expect(parseAddrFragment(`#${address}/${notAvk}`).status).toBe('error');
    expect(parseAddrFragment('#only').status).toBe('error');
    expect(parseAddrFragment('#/').status).toBe('error');
    expect(parseAddrFragment('').status).toBe('empty');
  });

  it('parses a valid balance fragment with zkatt handle', () => {
    const address = encodeBech32m(EXPLORER_HRPS.zk, p(32, 5));
    const assetId = 'ab'.repeat(32);
    const att = encodeBech32m(EXPLORER_HRPS.zkatt, p(32, 6));
    const result = parseBalanceFragment(`#${address}/${assetId}/h:${att}`);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.attestationForm).toBe('handle');
    }
  });

  it('parses balance inline form and holder hint', () => {
    const address = encodeBech32m(EXPLORER_HRPS.zk, p(32, 5));
    const assetId = 'cd'.repeat(32);
    const result = parseBalanceFragment(
      `#${address}/${assetId}/i:YWJj;h=${encodeURIComponent('https://h.example,https://h2.example')}`,
    );
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.attestationForm).toBe('inline');
      expect(result.attestationInline).toBe('YWJj');
      expect(result.holderHint).toBe('https://h.example,https://h2.example');
    }
  });

  it('rejects wrong HRP for zkatt handle', () => {
    const address = encodeBech32m(EXPLORER_HRPS.zk, p(32, 5));
    const assetId = 'ab'.repeat(32);
    const wrong = encodeBech32m(EXPLORER_HRPS.zkview, p(32, 6));
    const result = parseBalanceFragment(`#${address}/${assetId}/h:${wrong}`);
    expect(result.status).toBe('error');
  });

  it('rejects balance wrong part count, empty parts, bad asset_id, empty h:/i:', () => {
    const address = encodeBech32m(EXPLORER_HRPS.zk, p(32, 5));
    const assetId = 'ab'.repeat(32);
    const att = encodeBech32m(EXPLORER_HRPS.zkatt, p(32, 6));
    expect(parseBalanceFragment(`#${address}/${assetId}`).status).toBe('error');
    expect(parseBalanceFragment(`#${address}//h:${att}`).status).toBe('error');
    expect(parseBalanceFragment(`#${address}/NOTHEX/h:${att}`).status).toBe('error');
    expect(parseBalanceFragment(`#${address}/${assetId}/h:`).status).toBe('error');
    expect(parseBalanceFragment(`#${address}/${assetId}/i:`).status).toBe('error');
    expect(parseBalanceFragment(`#${address}/${assetId}/neither`).status).toBe('error');
    // Bare bech32 without h:/i: discriminator.
    expect(parseBalanceFragment(`#${address}/${assetId}/${att}`).status).toBe('error');
    expect(parseBalanceFragment('').status).toBe('empty');
    expect(parseBalanceFragment('#').status).toBe('empty');
  });

  it('returns empty when fragment is missing', () => {
    expect(parseTxFragment('').status).toBe('empty');
    expect(parseTxFragment('#').status).toBe('empty');
  });

  it('readLocationHash returns window hash and empty when window is undefined', () => {
    const original = window.location.hash;
    window.location.hash = '#test-fragment';
    expect(readLocationHash()).toBe('#test-fragment');
    window.location.hash = original;

    vi.stubGlobal('window', undefined);
    expect(readLocationHash()).toBe('');
  });

  it('stringifies non-Error parser failures for every fragment kind', () => {
    const hostile = {
      startsWith: () => {
        throw 'fragment-access-failed';
      },
    } as unknown as string;
    expect(parseTxFragment(hostile)).toEqual({
      status: 'error',
      message: 'fragment-access-failed',
    });
    expect(parseAddrFragment(hostile)).toEqual({
      status: 'error',
      message: 'fragment-access-failed',
    });
    expect(parseBalanceFragment(hostile)).toEqual({
      status: 'error',
      message: 'fragment-access-failed',
    });
  });

  it('rejects defensive undefined split fields for every fragment grammar', () => {
    const splitBody = (parts: unknown[]): string =>
      ({
        startsWith: () => false,
        length: 1,
        indexOf: () => -1,
        split: () => parts,
      }) as unknown as string;

    expect(parseTxFragment(splitBody([undefined, 'view'])).status).toBe('error');
    expect(parseTxFragment(splitBody(['bundle', undefined])).status).toBe('error');
    expect(parseAddrFragment(splitBody([undefined, 'avk'])).status).toBe('error');
    expect(parseAddrFragment(splitBody(['address', undefined])).status).toBe('error');
    expect(parseBalanceFragment(splitBody([undefined, 'asset', 'att'])).status).toBe('error');
    expect(parseBalanceFragment(splitBody(['address', undefined, 'att'])).status).toBe('error');
    expect(parseBalanceFragment(splitBody(['address', 'asset', undefined])).status).toBe('error');
  });
});
