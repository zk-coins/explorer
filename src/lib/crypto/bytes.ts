/**
 * Small byte helpers shared by bearer crypto paths.
 * Fail-closed: no silent pad/truncate.
 */

const HEX_RE = /^(?:[0-9a-f]{2})+$/;

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}

export function encodeHexLower(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) {
    out += b.toString(16).padStart(2, '0');
  }
  return out;
}

export function decodeHexExact(hex: string, byteLen: number, field: string): Uint8Array {
  if (typeof hex !== 'string') {
    throw new Error(`${field}: expected hex string`);
  }
  if (hex.length !== byteLen * 2) {
    throw new Error(`${field}: expected ${byteLen * 2} hex chars, got ${hex.length}`);
  }
  if (!HEX_RE.test(hex)) {
    throw new Error(
      `${field}: non-canonical hex (must be lowercase 0-9a-f only, no 0x/whitespace)`,
    );
  }
  const out = new Uint8Array(byteLen);
  for (let i = 0; i < byteLen; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) {
    total += p.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function readU32Be(buf: Uint8Array, offset: number): number {
  if (offset + 4 > buf.length) {
    throw new Error('readU32Be: truncated');
  }
  return (
    ((buf[offset]! << 24) |
      (buf[offset + 1]! << 16) |
      (buf[offset + 2]! << 8) |
      buf[offset + 3]!) >>>
    0
  );
}

export function writeU32Be(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`writeU32Be: value out of u32 range: ${value}`);
  }
  const out = new Uint8Array(4);
  out[0] = (value >>> 24) & 0xff;
  out[1] = (value >>> 16) & 0xff;
  out[2] = (value >>> 8) & 0xff;
  out[3] = value & 0xff;
  return out;
}

export function writeU64Be(value: bigint): Uint8Array {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new Error(`writeU64Be: value out of u64 range: ${value.toString()}`);
  }
  const out = new Uint8Array(8);
  let v = value;
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

export function readU64Be(buf: Uint8Array, offset: number): bigint {
  if (offset + 8 > buf.length) {
    throw new Error('readU64Be: truncated');
  }
  let v = 0n;
  for (let i = 0; i < 8; i++) {
    v = (v << 8n) | BigInt(buf[offset + i]!);
  }
  return v;
}

export function readU128Be(buf: Uint8Array, offset: number): bigint {
  if (offset + 16 > buf.length) {
    throw new Error('readU128Be: truncated');
  }
  let v = 0n;
  for (let i = 0; i < 16; i++) {
    v = (v << 8n) | BigInt(buf[offset + i]!);
  }
  return v;
}

export function writeU128Be(value: bigint): Uint8Array {
  if (value < 0n || value >= 1n << 128n) {
    throw new Error(`writeU128Be: value out of u128 range: ${value.toString()}`);
  }
  const out = new Uint8Array(16);
  let v = value;
  for (let i = 15; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/**
 * Exact decoded byte length of a base64url (no-pad) string — without allocating
 * the decoded buffer. Used to enforce size limits before `atob` / copy.
 *
 * Remainder 1 mod 4 is invalid base64url. Remainder 2 → +1 byte, 3 → +2 bytes.
 */
export function base64UrlDecodedLength(input: string): number {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error('base64url: empty input');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(input)) {
    throw new Error('base64url: non-alphabet character');
  }
  const n = input.length;
  const mod = n % 4;
  if (mod === 1) {
    throw new Error('base64url: invalid length');
  }
  const full = Math.floor(n / 4) * 3;
  if (mod === 0) {
    return full;
  }
  if (mod === 2) {
    return full + 1;
  }
  return full + 2;
}

/** Base64url without padding (RFC 4648 §5). */
export function base64UrlDecodeNoPad(
  input: string,
  opts: { maxDecodedBytes?: number } = {},
): Uint8Array {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error('base64url: empty input');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(input)) {
    throw new Error('base64url: non-alphabet character');
  }
  // Size gate BEFORE atob / allocation.
  const expectedLen = base64UrlDecodedLength(input);
  if (opts.maxDecodedBytes !== undefined) {
    if (
      !Number.isInteger(opts.maxDecodedBytes) ||
      opts.maxDecodedBytes <= 0 ||
      !Number.isSafeInteger(opts.maxDecodedBytes)
    ) {
      throw new Error(
        `base64url: maxDecodedBytes must be a positive safe integer, got ${opts.maxDecodedBytes}`,
      );
    }
    if (expectedLen > opts.maxDecodedBytes) {
      throw new Error(`base64url: decoded size ${expectedLen} exceeds max ${opts.maxDecodedBytes}`);
    }
  }
  const padLen = (4 - (input.length % 4)) % 4;
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLen);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error('base64url: decode failed');
  }
  if (binary.length !== expectedLen) {
    throw new Error(`base64url: decoded length ${binary.length} ≠ expected ${expectedLen}`);
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function base64UrlEncodeNoPad(input: Uint8Array): string {
  let binary = '';
  for (const b of input) {
    binary += String.fromCharCode(b);
  }
  const b64 = btoa(binary);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
