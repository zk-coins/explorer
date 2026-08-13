/**
 * crypto/bytes helpers — fail-closed arms and untested exports.
 */

import { describe, expect, it } from 'vitest';
import {
  base64UrlDecodeNoPad,
  base64UrlDecodedLength,
  base64UrlEncodeNoPad,
  bytesEqual,
  concatBytes,
  decodeHexExact,
  encodeHexLower,
  readU128Be,
  readU32Be,
  readU64Be,
  writeU128Be,
  writeU32Be,
  writeU64Be,
} from '@/lib/crypto/bytes';

describe('crypto/bytes', () => {
  it('bytesEqual length-mismatch and equal', () => {
    expect(bytesEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
  });

  it('decodeHexExact wrong type/length/non-canonical and happy path', () => {
    expect(() => decodeHexExact(1 as unknown as string, 1, 'f')).toThrow(/hex string/);
    expect(() => decodeHexExact('aa', 2, 'f')).toThrow(/expected 4 hex/);
    expect(() => decodeHexExact('AABB', 2, 'f')).toThrow(/non-canonical/);
    expect(() => decodeHexExact('gg', 1, 'f')).toThrow(/non-canonical/);
    expect(decodeHexExact('0a0b', 2, 'f')).toEqual(new Uint8Array([10, 11]));
  });

  it('concatBytes zero and multiple parts', () => {
    expect(concatBytes()).toEqual(new Uint8Array(0));
    expect(concatBytes(new Uint8Array([1]), new Uint8Array([2, 3]))).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it('integer codecs throw on truncation and out-of-range', () => {
    expect(() => readU32Be(new Uint8Array(3), 0)).toThrow(/truncated/);
    expect(() => writeU32Be(-1)).toThrow(/u32 range/);
    expect(() => writeU32Be(1.5)).toThrow(/u32 range/);
    expect(() => writeU32Be(0x1_0000_0000)).toThrow(/u32 range/);
    expect(writeU32Be(0x01020304)).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(readU32Be(new Uint8Array([1, 2, 3, 4]), 0)).toBe(0x01020304);

    expect(() => writeU64Be(-1n)).toThrow(/u64 range/);
    expect(() => writeU64Be(1n << 64n)).toThrow(/u64 range/);
    const u64 = writeU64Be(0x0102030405060708n);
    expect(readU64Be(u64, 0)).toBe(0x0102030405060708n);
    expect(() => readU64Be(new Uint8Array(7), 0)).toThrow(/truncated/);

    expect(() => writeU128Be(-1n)).toThrow(/u128 range/);
    expect(() => writeU128Be(1n << 128n)).toThrow(/u128 range/);
    const u128 = writeU128Be(0x0102n);
    expect(readU128Be(u128, 0)).toBe(0x0102n);
    expect(() => readU128Be(new Uint8Array(15), 0)).toThrow(/truncated/);
  });

  it('base64UrlDecodedLength empty/non-alphabet/mod1 and mod branches', () => {
    expect(() => base64UrlDecodedLength(7 as unknown as string)).toThrow(/empty/);
    expect(() => base64UrlDecodedLength('')).toThrow(/empty/);
    expect(() => base64UrlDecodedLength('!!!')).toThrow(/non-alphabet/);
    expect(() => base64UrlDecodedLength('a')).toThrow(/invalid length/);
    // mod 0: 4 chars → 3 bytes
    expect(base64UrlDecodedLength('YQ=='.replace(/=/g, '') + 'YQ')).toBeGreaterThan(0);
    expect(base64UrlDecodedLength('YWJj')).toBe(3); // "abc"
    expect(base64UrlDecodedLength('YQ')).toBe(1); // "a" padded
    expect(base64UrlDecodedLength('YWE')).toBe(2); // "aa"
  });

  it('base64UrlDecodeNoPad happy path and validation', () => {
    expect(() => base64UrlDecodeNoPad(7 as unknown as string)).toThrow(/empty/);
    expect(() => base64UrlDecodeNoPad('')).toThrow(/empty/);
    expect(() => base64UrlDecodeNoPad('!!!')).toThrow(/non-alphabet/);
    expect(() => base64UrlDecodeNoPad('YWJj', { maxDecodedBytes: 0 })).toThrow(/maxDecodedBytes/);
    expect(() => base64UrlDecodeNoPad('YWJj', { maxDecodedBytes: 1.5 })).toThrow(/maxDecodedBytes/);
    expect(() =>
      base64UrlDecodeNoPad('YWJj', { maxDecodedBytes: Number.MAX_SAFE_INTEGER + 1 }),
    ).toThrow(/maxDecodedBytes/);
    expect(() => base64UrlDecodeNoPad('YWJj', { maxDecodedBytes: 2 })).toThrow(/exceeds max/);
    const encoded = base64UrlEncodeNoPad(new Uint8Array([1, 2, 3, 4]));
    expect(base64UrlDecodeNoPad(encoded)).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(encodeHexLower(new Uint8Array([0x0a]))).toBe('0a');

    // atob throws path: invent invalid alphabet that still passes our regex is hard
    // (charset is strict). Simulate via stubbing atob.
    const original = globalThis.atob;
    globalThis.atob = () => {
      throw new Error('atob fail');
    };
    try {
      expect(() => base64UrlDecodeNoPad('YWJj')).toThrow(/decode failed/);
    } finally {
      globalThis.atob = original;
    }

    // decoded-length-mismatch after successful atob with wrong length.
    globalThis.atob = () => 'x'; // expectedLen for YWJj is 3
    try {
      expect(() => base64UrlDecodeNoPad('YWJj')).toThrow(/decoded length/);
    } finally {
      globalThis.atob = original;
    }
  });
});
