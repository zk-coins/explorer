import { describe, expect, it } from 'vitest';
import {
  Bech32mError,
  decodeBech32m,
  decodeExplorerBech32m,
  encodeBech32m,
  EXPLORER_HRPS,
} from '@/lib/bech32m';

function payload(n: number, fill = 0xab): Uint8Array {
  return Uint8Array.from({ length: n }, () => fill);
}

describe('Bech32m HRP parsing (§1.4 / §1.7.7)', () => {
  it('accepts valid zkview (32-byte payload)', () => {
    const p = payload(32, 0x11);
    const encoded = encodeBech32m(EXPLORER_HRPS.zkview, p);
    const out = decodeExplorerBech32m(encoded, EXPLORER_HRPS.zkview, [32]);
    expect(Array.from(out)).toEqual(Array.from(p));
  });

  it('accepts valid zkbid (32-byte payload)', () => {
    const p = payload(32, 0x22);
    const encoded = encodeBech32m(EXPLORER_HRPS.zkbid, p);
    const out = decodeExplorerBech32m(encoded, EXPLORER_HRPS.zkbid, [32]);
    expect(Array.from(out)).toEqual(Array.from(p));
  });

  it('accepts valid zkatt (32-byte payload)', () => {
    const p = payload(32, 0x33);
    const encoded = encodeBech32m(EXPLORER_HRPS.zkatt, p);
    const out = decodeExplorerBech32m(encoded, EXPLORER_HRPS.zkatt, [32]);
    expect(Array.from(out)).toEqual(Array.from(p));
  });

  it('accepts valid zkavk (32-byte and 64-byte payloads)', () => {
    const p32 = payload(32, 0x44);
    const p64 = payload(64, 0x45);
    expect(
      Array.from(
        decodeExplorerBech32m(
          encodeBech32m(EXPLORER_HRPS.zkavk, p32),
          EXPLORER_HRPS.zkavk,
          [32, 64],
        ),
      ),
    ).toEqual(Array.from(p32));
    expect(
      Array.from(
        decodeExplorerBech32m(
          encodeBech32m(EXPLORER_HRPS.zkavk, p64),
          EXPLORER_HRPS.zkavk,
          [32, 64],
        ),
      ),
    ).toEqual(Array.from(p64));
  });

  it('accepts valid zk address HRP', () => {
    const p = payload(32, 0x55);
    const encoded = encodeBech32m(EXPLORER_HRPS.zk, p);
    const out = decodeExplorerBech32m(encoded, EXPLORER_HRPS.zk, [32]);
    expect(Array.from(out)).toEqual(Array.from(p));
  });

  it('rejects wrong HRP for zkview (e.g. zkbid presented as view)', () => {
    const encoded = encodeBech32m(EXPLORER_HRPS.zkbid, payload(32));
    expect(() => decodeExplorerBech32m(encoded, EXPLORER_HRPS.zkview, [32])).toThrow(Bech32mError);
    expect(() => decodeExplorerBech32m(encoded, EXPLORER_HRPS.zkview, [32])).toThrow(
      /expected HRP/,
    );
  });

  it('rejects wrong HRP for zkbid', () => {
    const encoded = encodeBech32m(EXPLORER_HRPS.zkview, payload(32));
    expect(() => decodeExplorerBech32m(encoded, EXPLORER_HRPS.zkbid, [32])).toThrow(/expected HRP/);
  });

  it('rejects wrong HRP for zkatt', () => {
    const encoded = encodeBech32m(EXPLORER_HRPS.zk, payload(32));
    expect(() => decodeExplorerBech32m(encoded, EXPLORER_HRPS.zkatt, [32])).toThrow(/expected HRP/);
  });

  it('rejects wrong HRP for zkavk', () => {
    const encoded = encodeBech32m(EXPLORER_HRPS.zkview, payload(32));
    expect(() => decodeExplorerBech32m(encoded, EXPLORER_HRPS.zkavk, [32, 64])).toThrow(
      /expected HRP/,
    );
  });

  it('rejects garbage and mixed case', () => {
    expect(() => decodeBech32m('not-bech32')).toThrow(Bech32mError);
    const good = encodeBech32m(EXPLORER_HRPS.zkview, payload(32));
    // Mixed case is forbidden by BIP-173 (first letter of HRP upper, rest lower).
    const forced = `Z${good.slice(1)}`;
    expect(() => decodeBech32m(forced)).toThrow(Bech32mError);
  });
});
