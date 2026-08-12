/**
 * ZBE §4.2.1 — positive roundtrip + one negative case per violation class.
 */

import { describe, expect, it } from 'vitest';
import {
  ZBE_CHUNK,
  ZBE_MAGIC,
  ZBE_TAG_LEN,
  ZbeError,
  verifyBlobId,
  zbeNonce,
  zbeOpen,
  zbeSeal,
} from '@/lib/crypto/zbe';
import { sha256 } from '@/lib/crypto/sha256';

function testKtx(): Uint8Array {
  // Deterministic non-zero fixture key (not a protocol pin).
  return Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff);
}

function parseChunks(ct: Uint8Array): { n: number; chunks: Uint8Array[] } {
  expect(ct.length).toBeGreaterThanOrEqual(8);
  expect(ct.slice(0, 4)).toEqual(ZBE_MAGIC);
  const n = ((ct[4]! << 24) | (ct[5]! << 16) | (ct[6]! << 8) | ct[7]!) >>> 0;
  let offset = 8;
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < n; i++) {
    const len =
      ((ct[offset]! << 24) | (ct[offset + 1]! << 16) | (ct[offset + 2]! << 8) | ct[offset + 3]!) >>>
      0;
    offset += 4;
    chunks.push(ct.slice(offset, offset + len));
    offset += len;
  }
  expect(offset).toBe(ct.length);
  return { n, chunks };
}

function frame(n: number, chunks: Uint8Array[]): Uint8Array {
  let total = 8;
  for (const c of chunks) {
    total += 4 + c.length;
  }
  const out = new Uint8Array(total);
  out.set(ZBE_MAGIC, 0);
  out[4] = (n >>> 24) & 0xff;
  out[5] = (n >>> 16) & 0xff;
  out[6] = (n >>> 8) & 0xff;
  out[7] = n & 0xff;
  let o = 8;
  for (const c of chunks) {
    const len = c.length;
    out[o] = (len >>> 24) & 0xff;
    out[o + 1] = (len >>> 16) & 0xff;
    out[o + 2] = (len >>> 8) & 0xff;
    out[o + 3] = len & 0xff;
    o += 4;
    out.set(c, o);
    o += c.length;
  }
  return out;
}

describe('ZBE §4.2.1', () => {
  it('roundtrips a small plaintext and content-addresses blob_id', () => {
    const k = testKtx();
    const p = new TextEncoder().encode('zkCoins ZBE positive fixture');
    const { ciphertext, blobId } = zbeSeal(k, p);
    expect(verifyBlobId(ciphertext, blobId)).toBe(true);
    expect(blobId).toEqual(sha256(ciphertext));
    expect(zbeOpen(k, ciphertext)).toEqual(p);
  });

  it('roundtrips empty plaintext with N = 1', () => {
    const k = testKtx();
    const { ciphertext, blobId } = zbeSeal(k, new Uint8Array(0));
    const { n, chunks } = parseChunks(ciphertext);
    expect(n).toBe(1);
    expect(chunks[0]!.length).toBe(ZBE_TAG_LEN);
    expect(zbeOpen(k, ciphertext)).toEqual(new Uint8Array(0));
    expect(blobId).toEqual(sha256(ciphertext));
  });

  it('roundtrips CHUNK+1 → N = 2', () => {
    const k = testKtx();
    const p = new Uint8Array(ZBE_CHUNK + 1);
    p.fill(0x44);
    const { ciphertext } = zbeSeal(k, p);
    const { n, chunks } = parseChunks(ciphertext);
    expect(n).toBe(2);
    expect(chunks[0]!.length).toBe(ZBE_CHUNK + ZBE_TAG_LEN);
    expect(chunks[1]!.length).toBe(1 + ZBE_TAG_LEN);
    expect(zbeOpen(k, ciphertext)).toEqual(p);
  });

  it('rejects wrong key (auth_failed)', () => {
    const k = testKtx();
    const p = new TextEncoder().encode('wrong-key probe');
    const { ciphertext } = zbeSeal(k, p);
    const wrong = k.slice();
    const firstByte = wrong[0];
    if (firstByte === undefined) throw new Error('key fixture must not be empty');
    wrong[0] = firstByte ^ 0x01;
    try {
      zbeOpen(wrong, ciphertext);
      expect.fail('expected auth failure');
    } catch (err) {
      expect(err).toBeInstanceOf(ZbeError);
      expect((err as ZbeError).code).toBe('auth_failed');
    }
  });

  it('rejects flipped chunk byte (auth_failed / tampered chunk)', () => {
    const k = testKtx();
    const p = new TextEncoder().encode('flip-a-byte');
    const { ciphertext } = zbeSeal(k, p);
    const tampered = ciphertext.slice();
    // Flip a byte inside C_0 body (after magic+N+len prefix = 12).
    tampered[12]! ^= 0xff;
    try {
      zbeOpen(k, tampered);
      expect.fail('expected auth failure');
    } catch (err) {
      expect(err).toBeInstanceOf(ZbeError);
      expect((err as ZbeError).code).toBe('auth_failed');
    }
  });

  it('rejects swapped chunk order (AAD binds index)', () => {
    const k = testKtx();
    const p = new Uint8Array(ZBE_CHUNK + 1);
    p.fill(0x55);
    const { ciphertext } = zbeSeal(k, p);
    const { n, chunks } = parseChunks(ciphertext);
    expect(n).toBe(2);
    const swapped = frame(n, [chunks[1]!, chunks[0]!]);
    try {
      zbeOpen(k, swapped);
      expect.fail('expected auth failure on swap');
    } catch (err) {
      expect(err).toBeInstanceOf(ZbeError);
      expect((err as ZbeError).code).toBe('auth_failed');
    }
  });

  it('rejects N-adjusted truncation (AAD binds total count)', () => {
    const k = testKtx();
    const p = new Uint8Array(ZBE_CHUNK + 1);
    p.fill(0x66);
    const { ciphertext } = zbeSeal(k, p);
    const { n, chunks } = parseChunks(ciphertext);
    expect(n).toBe(2);
    // Keep only C_0 but rewrite N=1 — framing OK, AAD N mismatch → auth_failed.
    const truncated = frame(1, [chunks[0]!]);
    try {
      zbeOpen(k, truncated);
      expect.fail('expected auth failure on N rewrite');
    } catch (err) {
      expect(err).toBeInstanceOf(ZbeError);
      expect((err as ZbeError).code).toBe('auth_failed');
    }
  });

  it('rejects truncated stream (chunk_count_mismatch)', () => {
    const k = testKtx();
    const p = new Uint8Array(ZBE_CHUNK + 1);
    p.fill(0x77);
    const { ciphertext } = zbeSeal(k, p);
    const { n, chunks } = parseChunks(ciphertext);
    expect(n).toBe(2);
    // Header still claims N=2 but only C_0 is present.
    const header = new Uint8Array(8 + 4 + chunks[0]!.length);
    header.set(ZBE_MAGIC, 0);
    header[4] = 0;
    header[5] = 0;
    header[6] = 0;
    header[7] = 2;
    const len = chunks[0]!.length;
    header[8] = (len >>> 24) & 0xff;
    header[9] = (len >>> 16) & 0xff;
    header[10] = (len >>> 8) & 0xff;
    header[11] = len & 0xff;
    header.set(chunks[0]!, 12);
    try {
      zbeOpen(k, header);
      expect.fail('expected chunk_count_mismatch');
    } catch (err) {
      expect(err).toBeInstanceOf(ZbeError);
      expect((err as ZbeError).code).toBe('chunk_count_mismatch');
    }
  });

  it('rejects wrong magic', () => {
    const k = testKtx();
    const { ciphertext } = zbeSeal(k, new TextEncoder().encode('x'));
    for (let i = 0; i < ZBE_MAGIC.length; i++) {
      const bad = ciphertext.slice();
      bad[i]! ^= 0xff;
      try {
        zbeOpen(k, bad);
        expect.fail('expected wrong_magic');
      } catch (err) {
        expect(err).toBeInstanceOf(ZbeError);
        expect((err as ZbeError).code).toBe('wrong_magic');
      }
    }
  });

  it('rejects trailing bytes', () => {
    const k = testKtx();
    const { ciphertext } = zbeSeal(k, new TextEncoder().encode('trail'));
    const bad = new Uint8Array(ciphertext.length + 1);
    bad.set(ciphertext);
    bad[bad.length - 1] = 0;
    try {
      zbeOpen(k, bad);
      expect.fail('expected trailing_bytes');
    } catch (err) {
      expect(err).toBeInstanceOf(ZbeError);
      expect((err as ZbeError).code).toBe('trailing_bytes');
    }
  });

  it('blob_id mismatch when ciphertext is manipulated', () => {
    const k = testKtx();
    const { ciphertext, blobId } = zbeSeal(k, new TextEncoder().encode('id-check'));
    const tampered = ciphertext.slice();
    tampered[tampered.length - 1]! ^= 0x01;
    expect(verifyBlobId(tampered, blobId)).toBe(false);
    expect(verifyBlobId(ciphertext, blobId)).toBe(true);
  });

  it('rejects bad key length, non-Uint8Array plaintext/ciphertext, truncated framing', () => {
    expect(() => zbeSeal(new Uint8Array(16), new Uint8Array(1))).toThrow(ZbeError);
    expect(() => zbeOpen(new Uint8Array(16), new Uint8Array(20))).toThrow(ZbeError);
    expect(() => zbeSeal('bad-key' as unknown as Uint8Array, new Uint8Array(1))).toThrow(
      /got string/,
    );
    expect(() => zbeSeal(testKtx(), 'not-bytes' as unknown as Uint8Array)).toThrow(
      /plaintext must be a Uint8Array/,
    );
    expect(() => zbeOpen(testKtx(), 'not-bytes' as unknown as Uint8Array)).toThrow(
      /ciphertext must be a Uint8Array/,
    );
    expect(() => zbeOpen(testKtx(), new Uint8Array(4))).toThrow(/truncated/);
  });

  it('rejects N=0, chunk length overrun, chunk too short', () => {
    const k = testKtx();
    // N=0 framed ciphertext.
    const n0 = new Uint8Array(8);
    n0.set(ZBE_MAGIC, 0);
    // n already 0
    try {
      zbeOpen(k, n0);
      expect.fail('expected invalid_chunk_count');
    } catch (err) {
      expect((err as ZbeError).code).toBe('invalid_chunk_count');
    }

    // N=1 but length claims more than remaining.
    const overrun = new Uint8Array(12);
    overrun.set(ZBE_MAGIC, 0);
    overrun[7] = 1;
    overrun[8] = 0;
    overrun[9] = 0;
    overrun[10] = 0;
    overrun[11] = 100; // len=100, only 0 remaining
    try {
      zbeOpen(k, overrun);
      expect.fail('expected chunk_length_overrun');
    } catch (err) {
      expect((err as ZbeError).code).toBe('chunk_length_overrun');
    }

    // N=1, len shorter than tag.
    const short = new Uint8Array(12);
    short.set(ZBE_MAGIC, 0);
    short[7] = 1;
    short[11] = 8; // len=8 < 16
    // need 8 more bytes of payload after len
    const shortFull = new Uint8Array(12 + 8);
    shortFull.set(short, 0);
    try {
      zbeOpen(k, shortFull);
      expect.fail('expected chunk_too_short');
    } catch (err) {
      expect((err as ZbeError).code).toBe('chunk_too_short');
    }
  });

  it('zbeNonce out of range; verifyBlobId wrong length', () => {
    expect(() => zbeNonce(-1)).toThrow(/u32 range/);
    expect(() => zbeNonce(1.5)).toThrow(/u32 range/);
    expect(() => zbeNonce(0x1_0000_0000)).toThrow(/u32 range/);
    expect(() => verifyBlobId(new Uint8Array(1), new Uint8Array(16))).toThrow(/32 bytes/);
  });
});
