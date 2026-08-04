/**
 * max_blob_bytes enforcement on streamed / Content-Length-limited body reads.
 */

import { describe, expect, it } from 'vitest';
import { assertDecodedSize, readArrayBufferLimited, u64ToSafeByteLimit } from '@/lib/api/bodyLimit';
import { fetchBlossomBlob } from '@/lib/api/blossom';
import { NodeApiError } from '@/lib/api/types';
import { sha256 } from '@/lib/crypto/sha256';

function mockResponse(body: Uint8Array, headers: Record<string, string> = {}): Response {
  return new Response(body as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      ...headers,
    },
  });
}

/** Response-like object with controllable body stream / arrayBuffer fallback. */
function fakeRes(opts: {
  cl?: string | null;
  chunks?: Uint8Array[];
  arrayBuffer?: Uint8Array;
  cancelThrows?: boolean;
}): Response {
  const headers = {
    get: (k: string) => {
      if (k.toLowerCase() === 'content-length') {
        return opts.cl === undefined ? null : opts.cl;
      }
      return null;
    },
  };
  if (opts.arrayBuffer !== undefined && opts.chunks === undefined) {
    return {
      ok: true,
      status: 200,
      headers,
      body: null,
      arrayBuffer: async () =>
        opts.arrayBuffer!.buffer.slice(
          opts.arrayBuffer!.byteOffset,
          opts.arrayBuffer!.byteOffset + opts.arrayBuffer!.byteLength,
        ),
    } as unknown as Response;
  }
  const chunks = opts.chunks ?? [];
  let i = 0;
  return {
    ok: true,
    status: 200,
    headers,
    body: {
      getReader: () => ({
        read: async () => {
          if (i >= chunks.length) return { done: true, value: undefined };
          const value = chunks[i]!;
          i += 1;
          return { done: false, value };
        },
        cancel: async () => {
          if (opts.cancelThrows) throw new Error('cancel failed');
        },
      }),
    },
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

describe('body limit (max_blob_bytes)', () => {
  it('u64ToSafeByteLimit rejects out-of-range bigint and unsafe number', () => {
    expect(() => u64ToSafeByteLimit(0n, 'ctx')).toThrow(/MAX_SAFE_INTEGER/);
    expect(() => u64ToSafeByteLimit(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 'ctx')).toThrow(
      /MAX_SAFE_INTEGER/,
    );
    expect(u64ToSafeByteLimit(100n, 'ctx')).toBe(100);
    expect(() => u64ToSafeByteLimit(1.5, 'ctx')).toThrow(/positive safe integer/);
    expect(() => u64ToSafeByteLimit(-1, 'ctx')).toThrow(/positive safe integer/);
    expect(() => u64ToSafeByteLimit(Number.MAX_SAFE_INTEGER + 1, 'ctx')).toThrow(
      /positive safe integer/,
    );
    expect(u64ToSafeByteLimit(50, 'ctx')).toBe(50);
  });

  it('rejects Content-Length above the ceiling before reading', async () => {
    const body = new Uint8Array(16);
    const res = mockResponse(body, { 'Content-Length': '1000' });
    await expect(readArrayBufferLimited(res, 100, 'test')).rejects.toMatchObject({
      code: 'blob_too_large',
    });
  });

  it('rejects invalid and out-of-range Content-Length', async () => {
    await expect(
      readArrayBufferLimited(fakeRes({ cl: '12x', chunks: [new Uint8Array(1)] }), 100, 'test'),
    ).rejects.toMatchObject({ code: 'malformed_response' });
    // Content-Length larger than MAX_SAFE_INTEGER as decimal string.
    await expect(
      readArrayBufferLimited(
        fakeRes({ cl: '9007199254740992', chunks: [new Uint8Array(1)] }),
        100,
        'test',
      ),
    ).rejects.toMatchObject({ code: 'malformed_response' });
  });

  it('rejects streamed bodies larger than maxBytes (incl. cancel throw)', async () => {
    const body = new Uint8Array(200);
    body.fill(7);
    const res = mockResponse(body);
    await expect(readArrayBufferLimited(res, 50, 'test')).rejects.toMatchObject({
      code: 'blob_too_large',
    });

    await expect(
      readArrayBufferLimited(
        fakeRes({
          chunks: [new Uint8Array(40), new Uint8Array(40)],
          cancelThrows: true,
        }),
        50,
        'test',
      ),
    ).rejects.toMatchObject({ code: 'blob_too_large' });
  });

  it('rejects body length vs Content-Length mismatch on stream and fallback', async () => {
    await expect(
      readArrayBufferLimited(fakeRes({ cl: '10', chunks: [new Uint8Array(3)] }), 100, 'test'),
    ).rejects.toMatchObject({ code: 'malformed_response' });

    await expect(
      readArrayBufferLimited(fakeRes({ cl: '2', arrayBuffer: new Uint8Array(5) }), 100, 'test'),
    ).rejects.toMatchObject({ code: 'malformed_response' });

    await expect(
      readArrayBufferLimited(fakeRes({ arrayBuffer: new Uint8Array(50) }), 10, 'test'),
    ).rejects.toMatchObject({ code: 'blob_too_large' });
  });

  it('body:null fallback returns bytes when within maxBytes and CL matches or absent', async () => {
    const expected = new Uint8Array([9, 8, 7, 6]);
    const noCl = await readArrayBufferLimited(
      fakeRes({ arrayBuffer: expected }),
      100,
      'fallback-ok',
    );
    expect(noCl).toEqual(expected);

    const matchedCl = await readArrayBufferLimited(
      fakeRes({ cl: '4', arrayBuffer: expected }),
      100,
      'fallback-cl-ok',
    );
    expect(matchedCl).toEqual(expected);
  });

  it('skips undefined stream values and accepts matching CL', async () => {
    let n = 0;
    const res = {
      ok: true,
      status: 200,
      headers: { get: () => '2' },
      body: {
        getReader: () => ({
          read: async () => {
            n += 1;
            if (n === 1) return { done: false, value: undefined };
            if (n === 2) return { done: false, value: new Uint8Array([1, 2]) };
            return { done: true, value: undefined };
          },
          cancel: async () => {},
        }),
      },
    } as unknown as Response;
    const got = await readArrayBufferLimited(res, 100, 'test');
    expect(got).toEqual(new Uint8Array([1, 2]));
  });

  it('accepts a body within the limit', async () => {
    const body = new Uint8Array([1, 2, 3, 4]);
    const res = mockResponse(body, { 'Content-Length': '4' });
    const got = await readArrayBufferLimited(res, 100, 'test');
    expect(got).toEqual(body);
  });

  it('assertDecodedSize rejects non-integer, negative, and oversized', () => {
    expect(() => assertDecodedSize(200, 100, 'inline')).toThrow(NodeApiError);
    expect(() => assertDecodedSize(-1, 100, 'inline')).toThrow(/non-negative integer/);
    expect(() => assertDecodedSize(1.5, 100, 'inline')).toThrow(/non-negative integer/);
    expect(() => assertDecodedSize(10, 100, 'inline')).not.toThrow();
  });

  it('fetchBlossomBlob requires maxBlobBytes and enforces it', async () => {
    const payload = new Uint8Array(32);
    payload.fill(9);
    const blobId = sha256(payload);
    const fetchImpl: typeof fetch = async () =>
      mockResponse(payload, { 'Content-Length': String(payload.length) });

    await expect(
      // @ts-expect-error intentional missing maxBlobBytes
      fetchBlossomBlob(blobId, { fetchImpl, baseUrl: 'https://example.invalid' }),
    ).rejects.toThrow(/maxBlobBytes/);

    await expect(
      fetchBlossomBlob(blobId, {
        fetchImpl,
        baseUrl: 'https://example.invalid',
        maxBlobBytes: 16,
      }),
    ).rejects.toMatchObject({ code: 'blob_too_large' });

    const ok = await fetchBlossomBlob(blobId, {
      fetchImpl,
      baseUrl: 'https://example.invalid',
      maxBlobBytes: 1024,
    });
    expect(ok).toEqual(payload);
  });
});
