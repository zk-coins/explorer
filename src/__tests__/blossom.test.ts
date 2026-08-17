/**
 * Blossom fetch + multi-holder fallback paths.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBlossomBlob, fetchBlossomBlobFromHolders } from '@/lib/api/blossom';
import { NodeApiError } from '@/lib/api/types';
import { sha256 } from '@/lib/crypto/sha256';

function mockResponse(body: Uint8Array, init: { ok?: boolean; status?: number } = {}): Response {
  return new Response(body as unknown as BodyInit, {
    status: init.status ?? 200,
    statusText: init.ok === false ? 'err' : 'ok',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(body.length),
    },
  });
}

describe('blossom fetch', () => {
  const payload = new Uint8Array([1, 2, 3, 4, 5]);
  const blobId = sha256(payload);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects empty baseUrl override', async () => {
    await expect(
      fetchBlossomBlob(blobId, {
        baseUrl: '',
        maxBlobBytes: 1024,
        fetchImpl: async () => mockResponse(payload),
      }),
    ).rejects.toThrow(/empty/);
  });

  it('uses default NODE_BASE_URL when baseUrl omitted', async () => {
    const fetchImpl = async (url: string | URL | Request) => {
      expect(String(url)).toMatch(/\/blossom\//);
      return mockResponse(payload);
    };
    const got = await fetchBlossomBlob(blobId, { maxBlobBytes: 1024, fetchImpl });
    expect(got).toEqual(payload);
  });

  it('rejects wrong-length blobId', async () => {
    await expect(
      fetchBlossomBlob(new Uint8Array(16), {
        baseUrl: 'https://h.example',
        maxBlobBytes: 1024,
        fetchImpl: async () => mockResponse(payload),
      }),
    ).rejects.toThrow(/32 bytes/);

    await expect(
      fetchBlossomBlob('not-bytes' as unknown as Uint8Array, {
        baseUrl: 'https://h.example',
        maxBlobBytes: 1024,
        fetchImpl: async () => mockResponse(payload),
      }),
    ).rejects.toThrow(/got string/);
  });

  it('uses global fetch when fetchImpl is omitted', async () => {
    const fetchImpl = vi.fn(async () => mockResponse(payload));
    vi.stubGlobal('fetch', fetchImpl);
    await expect(
      fetchBlossomBlob(blobId, { baseUrl: 'https://h.example', maxBlobBytes: 1024 }),
    ).resolves.toEqual(payload);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('rewrapping invalid maxBlobBytes', async () => {
    await expect(
      fetchBlossomBlob(blobId, {
        baseUrl: 'https://h.example',
        maxBlobBytes: 0,
        fetchImpl: async () => mockResponse(payload),
      }),
    ).rejects.toThrow(/maxBlobBytes invalid/);
  });

  it('wraps network throw as NodeApiError', async () => {
    await expect(
      fetchBlossomBlob(blobId, {
        baseUrl: 'https://h.example',
        maxBlobBytes: 1024,
        fetchImpl: async () => {
          throw new TypeError('offline');
        },
      }),
    ).rejects.toMatchObject({ code: 'network_error' });

    await expect(
      fetchBlossomBlob(blobId, {
        baseUrl: 'https://h.example',
        maxBlobBytes: 1024,
        fetchImpl: async () => {
          throw 'offline string';
        },
      }),
    ).rejects.toMatchObject({ code: 'network_error', message: expect.stringMatching(/offline/) });
  });

  it('rejects non-ok HTTP and blob_id mismatch', async () => {
    await expect(
      fetchBlossomBlob(blobId, {
        baseUrl: 'https://h.example',
        maxBlobBytes: 1024,
        fetchImpl: async () => mockResponse(payload, { ok: false, status: 404 }),
      }),
    ).rejects.toMatchObject({ code: 'not_found' });

    await expect(
      fetchBlossomBlob(blobId, {
        baseUrl: 'https://h.example',
        maxBlobBytes: 1024,
        fetchImpl: async () => mockResponse(payload, { ok: false, status: 500 }),
      }),
    ).rejects.toMatchObject({ code: 'http_error' });

    const wrongBody = new Uint8Array([9, 9, 9]);
    await expect(
      fetchBlossomBlob(blobId, {
        baseUrl: 'https://h.example',
        maxBlobBytes: 1024,
        fetchImpl: async () => mockResponse(wrongBody),
      }),
    ).rejects.toMatchObject({ code: 'blob_id_mismatch' });
  });

  it('fetchBlossomBlobFromHolders: empty, first ok, fallback, all fail', async () => {
    await expect(fetchBlossomBlobFromHolders(blobId, [], { maxBlobBytes: 1024 })).rejects.toThrow(
      /holders list is empty/,
    );

    const ok = await fetchBlossomBlobFromHolders(
      blobId,
      ['https://a.example', 'https://b.example'],
      {
        maxBlobBytes: 1024,
        fetchImpl: async (url) => {
          if (String(url).includes('a.example')) return mockResponse(payload);
          throw new Error('should not reach b');
        },
      },
    );
    expect(ok.holder).toBe('https://a.example');
    expect(ok.body).toEqual(payload);

    const second = await fetchBlossomBlobFromHolders(
      blobId,
      ['https://a.example', 'https://b.example'],
      {
        maxBlobBytes: 1024,
        fetchImpl: async (url) => {
          if (String(url).includes('a.example')) {
            return mockResponse(payload, { ok: false, status: 404 });
          }
          return mockResponse(payload);
        },
      },
    );
    expect(second.holder).toBe('https://b.example');

    await expect(
      fetchBlossomBlobFromHolders(blobId, ['https://a.example', 'https://b.example'], {
        maxBlobBytes: 1024,
        fetchImpl: async () => mockResponse(payload, { ok: false, status: 503 }),
      }),
    ).rejects.toBeInstanceOf(NodeApiError);

    // A non-Error escaping after the fetch call reaches the generic fallback.
    await expect(
      fetchBlossomBlobFromHolders(blobId, ['https://a.example'], {
        maxBlobBytes: 1024,
        fetchImpl: async () =>
          Object.defineProperty({}, 'ok', {
            get() {
              throw 'plain-string-fail';
            },
          }) as Response,
      }),
    ).rejects.toThrow('fetchBlossomBlobFromHolders: all holders failed');
  });
});
