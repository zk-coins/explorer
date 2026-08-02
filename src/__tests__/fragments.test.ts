import { describe, expect, it } from 'vitest';
import { encodeBech32m, EXPLORER_HRPS } from '@/lib/bech32m';
import { parseAddrFragment, parseBalanceFragment, parseTxFragment } from '@/lib/fragments';

function p(n: number, fill: number): Uint8Array {
  return Uint8Array.from({ length: n }, () => fill);
}

describe('fragment parsing', () => {
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

  it('rejects swapped HRPs on tx fragment', () => {
    const wrongBundle = encodeBech32m(EXPLORER_HRPS.zkview, p(32, 1));
    const wrongView = encodeBech32m(EXPLORER_HRPS.zkbid, p(32, 2));
    const result = parseTxFragment(`#${wrongBundle}/${wrongView}`);
    expect(result.status).toBe('error');
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

  it('parses zkavk 32 B → incoming-only mode', () => {
    const address = encodeBech32m(EXPLORER_HRPS.zk, p(32, 3));
    const avk = encodeBech32m(EXPLORER_HRPS.zkavk, p(32, 4));
    const result = parseAddrFragment(`#${address}/${avk}`);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.avkByteLength).toBe(32);
    }
  });

  it('rejects wrong HRP on addr fragment', () => {
    const address = encodeBech32m(EXPLORER_HRPS.zk, p(32, 3));
    const notAvk = encodeBech32m(EXPLORER_HRPS.zkview, p(32, 4));
    const result = parseAddrFragment(`#${address}/${notAvk}`);
    expect(result.status).toBe('error');
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

  it('rejects wrong HRP for zkatt handle', () => {
    const address = encodeBech32m(EXPLORER_HRPS.zk, p(32, 5));
    const assetId = 'ab'.repeat(32);
    const wrong = encodeBech32m(EXPLORER_HRPS.zkview, p(32, 6));
    const result = parseBalanceFragment(`#${address}/${assetId}/h:${wrong}`);
    expect(result.status).toBe('error');
  });

  it('returns empty when fragment is missing', () => {
    expect(parseTxFragment('').status).toBe('empty');
    expect(parseTxFragment('#').status).toBe('empty');
  });
});
