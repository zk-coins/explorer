/**
 * Bech32m (BIP-350) codec for explorer bearer HRPs (§1.4 / §1.7.7).
 *
 * HRPs: zkview (32 B), zkbid (32 B), zkatt (32 B), zkavk (32 or 64 B),
 * and zk (32 B address — used in /addr and /balance fragments).
 *
 * The 90-character BIP-173 limit does NOT apply to these HRPs (§1.7.7).
 * Wrong HRP is a hard error — never silently accepted under another role.
 */

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const CHARSET_MAP: ReadonlyMap<string, number> = (() => {
  const m = new Map<string, number>();
  let i = 0;
  for (const c of CHARSET) {
    m.set(c, i);
    i += 1;
  }
  return m;
})();

const BECH32M_CONST = 0x2bc830a3;

/** Closed set of bearer / address HRPs the explorer understands. */
export const EXPLORER_HRPS = {
  zk: 'zk',
  zkview: 'zkview',
  zkbid: 'zkbid',
  zkatt: 'zkatt',
  zkavk: 'zkavk',
} as const;

export type ExplorerHrp = (typeof EXPLORER_HRPS)[keyof typeof EXPLORER_HRPS];

export class Bech32mError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Bech32mError';
  }
}

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
  for (let i = 0; i < hrp.length; i++) {
    ret.push(hrp.charCodeAt(i) >>> 5);
  }
  ret.push(0);
  for (let i = 0; i < hrp.length; i++) {
    ret.push(hrp.charCodeAt(i) & 31);
  }
  return ret;
}

function createChecksum(hrp: string, data: number[]): number[] {
  const values = hrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
  const mod = polymod(values) ^ BECH32M_CONST;
  const ret: number[] = [];
  for (let p = 0; p < 6; p++) {
    ret.push((mod >>> (5 * (5 - p))) & 31);
  }
  return ret;
}

function verifyChecksum(hrp: string, data: number[]): boolean {
  return polymod(hrpExpand(hrp).concat(data)) === BECH32M_CONST;
}

function convertBits(data: Uint8Array | number[], from: number, to: number, pad: true): number[];
function convertBits(
  data: Uint8Array | number[],
  from: number,
  to: number,
  pad: false,
): number[] | null;
function convertBits(
  data: Uint8Array | number[],
  from: number,
  to: number,
  pad: boolean,
): number[] | null {
  let acc = 0;
  let bits = 0;
  const ret: number[] = [];
  const maxv = (1 << to) - 1;
  for (let i = 0; i < data.length; i++) {
    const value = data[i]!;
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      ret.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) {
      ret.push((acc << (to - bits)) & maxv);
    }
    return ret;
  }
  if (bits >= from || (acc << (to - bits)) & maxv) {
    return null;
  }
  return ret;
}

export interface DecodedBech32m {
  hrp: string;
  payload: Uint8Array;
}

/**
 * Decode a Bech32m string and optionally require an exact HRP.
 * Throws Bech32mError on mixed case, bad charset, checksum, or wrong HRP.
 */
export function decodeBech32m(input: string, expectedHrp?: string): DecodedBech32m {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Bech32mError('empty Bech32m string');
  }
  const lower = input.toLowerCase();
  if (input !== lower && input !== input.toUpperCase()) {
    throw new Bech32mError('mixed-case Bech32m is invalid');
  }
  const s = lower;
  const pos = s.lastIndexOf('1');
  if (pos < 1 || pos + 7 > s.length) {
    throw new Bech32mError('missing Bech32m separator');
  }
  const hrp = s.slice(0, pos);
  if (expectedHrp !== undefined && hrp !== expectedHrp) {
    throw new Bech32mError(
      `expected HRP ${JSON.stringify(expectedHrp)}, got ${JSON.stringify(hrp)}`,
    );
  }
  const data: number[] = [];
  for (const ch of s.slice(pos + 1)) {
    const v = CHARSET_MAP.get(ch);
    if (v === undefined) {
      throw new Bech32mError(`invalid Bech32m character ${JSON.stringify(ch)}`);
    }
    data.push(v);
  }
  if (!verifyChecksum(hrp, data)) {
    throw new Bech32mError('Bech32m checksum failed');
  }
  const words = data.slice(0, data.length - 6);
  const bytes = convertBits(words, 5, 8, false);
  if (bytes === null) {
    throw new Bech32mError('non-canonical Bech32m padding');
  }
  return { hrp, payload: Uint8Array.from(bytes) };
}

/**
 * Encode a payload under a given HRP (Bech32m). Used by tests to build fixtures.
 */
export function encodeBech32m(hrp: string, payload: Uint8Array): string {
  if (typeof hrp !== 'string' || hrp.length === 0) {
    throw new Bech32mError('HRP is required');
  }
  if (payload.length === 0) {
    throw new Bech32mError('payload must not be empty');
  }
  const data = convertBits(payload, 8, 5, true);
  const checksum = createChecksum(hrp, data);
  const combined = data.concat(checksum);
  let out = `${hrp}1`;
  for (const d of combined) {
    out += CHARSET[d]!;
  }
  return out;
}

/** Decode and enforce payload length for a known explorer HRP. */
export function decodeExplorerBech32m(
  input: string,
  expectedHrp: ExplorerHrp,
  allowedPayloadLengths: number[],
): Uint8Array {
  const { payload } = decodeBech32m(input, expectedHrp);
  if (!allowedPayloadLengths.includes(payload.length)) {
    throw new Bech32mError(
      `HRP ${expectedHrp}: payload length ${payload.length} not in [${allowedPayloadLengths.join(',')}]`,
    );
  }
  return payload;
}
