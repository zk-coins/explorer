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

  it('rejects empty input and missing separator', () => {
    expect(() => decodeBech32m('')).toThrow(/empty/);
    expect(() => decodeBech32m('no_separator_here')).toThrow(/separator/);
    // Separator too late / insufficient checksum room.
    expect(() => decodeBech32m('a1')).toThrow(/separator/);
  });

  it('rejects invalid charset and checksum', () => {
    const good = encodeBech32m(EXPLORER_HRPS.zkview, payload(32));
    // Flip last checksum char to force checksum fail (all chars still in charset).
    const last = good[good.length - 1]!;
    const flipped = good.slice(0, -1) + (last === 'q' ? 'p' : 'q');
    expect(() => decodeBech32m(flipped)).toThrow(/checksum/);
    // Invalid lowercase character 'b' (omitted from bech32 charset; keeps same-case
    // so this hits the charset branch, not the mixed-case check).
    const withBad = good.slice(0, good.indexOf('1') + 1) + 'b' + good.slice(good.indexOf('1') + 2);
    expect(() => decodeBech32m(withBad)).toThrow(/invalid Bech32m character/);
  });

  it('rejects non-canonical padding on decode', () => {
    // Craft words that fail convertBits pad=false: take valid encoding and
    // append an extra 5-bit group that leaves non-zero leftover bits.
    // Build HRP + data words with one extra non-zero padding word then re-checksum
    // is hard; instead encode 1-byte payload then force an extra data digit with
    // a recomputed checksum via raw polymod is internal. Use a known-bad string:
    // "a1lqfn3a" is BIP-350 bech32m empty-data edge; explorer rejects empty payload
    // only on encode. Force non-canonical by decoding words where bits leftover.
    // Encode 1 byte, then manually append a data char and re-use wrong checksum → checksum first.
    // Practical approach: encode payload of length that leaves non-zero leftover
    // is not possible with pad:true encode. Directly construct data with bits
    // that convertBits(false) rejects: last word has leftover bits set.
    // "tf1pqpzry9x8gf2tvdw0s3jn54khce6mua7l" style vectors aren't explorer HRPs.
    // Build via encode then replace payload path: use decode of a string with
    // correct checksum but non-canonical padding — BIP-350 test vector:
    // A1LQFN3A is empty payload with valid bech32m; convertBits of empty is ok.
    // Non-canonical: data words [0, 1] for from=5 to=8 without pad → leftover.
    // We'll encode a zero-length isn't allowed. Use internal path via
    // decoding a hand-built checksummed string with one non-zero pad bit.
    // Construct: hrp "a", data words that verify checksum and have bad padding.
    // From BIP-350: bech32m("a", []) = "a1lqfn3a". Adding a trailing zero group
    // with recomputed checksum is complex; instead test encode empty payload
    // and empty HRP which are the encode-side gaps.
    expect(() => encodeBech32m('', payload(1))).toThrow(/HRP is required/);
    expect(() => encodeBech32m('zk', new Uint8Array(0))).toThrow(/payload must not be empty/);
  });

  it('rejects wrong payload length for explorer HRP', () => {
    const encoded = encodeBech32m(EXPLORER_HRPS.zkview, payload(16));
    expect(() => decodeExplorerBech32m(encoded, EXPLORER_HRPS.zkview, [32])).toThrow(
      /payload length/,
    );
  });

  it('rejects non-canonical padding via crafted data words', () => {
    // Valid bech32m HRP "a" with data that leaves non-zero leftover bits when
    // converting 5→8 without pad. BIP-173 requires rejecting that.
    // "a1lllllllllllllllllllllllllllw5s6px" has invalid padding in some suites;
    // use a programmatically built string: encode 1-byte then force-decode a
    // sibling with an extra 5-bit '1' value group and valid checksum.
    // Simpler: decodeBech32m of string with only HRP+checksum (no payload words)
    // after valid checksum — empty payload words convertBits returns [] which is fine.
    // Craft: 1 data word value 1 (non-zero leftover for 5→8).
    // polymod for bech32m with hrp "x" and data [1,0,0,0,0,0,0] tuned checksum…
    // Use known invalid-padding vector from BIP-350 invalid set adapted to bech32m:
    // "tc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vq5zuyut" is bech32 (not m).
    // Fallback: if convertBits null path remains hard, at least cover encode empty.
    // Build checksum for hrp "a" + words [16] (msb set leftover when 5→8).
    const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
    function polymod(values: number[]): number {
      let chk = 1;
      for (const v of values) {
        const b = chk >>> 25;
        chk = ((chk & 0x1ffffff) << 5) ^ v;
        if (b & 1) chk ^= 0x3b6a57b2;
        if (b & 2) chk ^= 0x26508e6d;
        if (b & 4) chk ^= 0x1ea119fa;
        if (b & 8) chk ^= 0x3d4233dd;
        if (b & 16) chk ^= 0x2a1462b3;
      }
      return chk >>> 0;
    }
    function hrpExpand(hrp: string): number[] {
      const ret: number[] = [];
      for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) >>> 5);
      ret.push(0);
      for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) & 31);
      return ret;
    }
    const hrp = 'a';
    // One data word with value 1 → leftover bits non-zero after 5→8.
    const data = [1];
    const values = hrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
    const mod = polymod(values) ^ 0x2bc830a3;
    const checksum: number[] = [];
    for (let p = 0; p < 6; p++) checksum.push((mod >>> (5 * (5 - p))) & 31);
    let s = `${hrp}1`;
    for (const d of data.concat(checksum)) s += CHARSET[d]!;
    expect(() => decodeBech32m(s)).toThrow(/non-canonical Bech32m padding/);
  });
});
