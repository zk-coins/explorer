/**
 * max_blob_bytes enforcement on streamed / Content-Length-limited body reads.
 */

import { describe, expect, it } from 'vitest';
import { assertDecodedSize, readArrayBufferLimited } from '@/lib/api/bodyLimit';
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

describe('body limit (max_blob_bytes)', () => {
  it('rejects Content-Length above the ceiling before reading', async () => {
    const body = new Uint8Array(16);
    const res = mockResponse(body, { 'Content-Length': '1000' });
    await expect(readArrayBufferLimited(res, 100, 'test')).rejects.toMatchObject({
      code: 'blob_too_large',
    });
  });

  it('rejects streamed bodies larger than maxBytes', async () => {
    const body = new Uint8Array(200);
    body.fill(7);
    const res = mockResponse(body);
    await expect(readArrayBufferLimited(res, 50, 'test')).rejects.toMatchObject({
      code: 'blob_too_large',
    });
  });

  it('accepts a body within the limit', async () => {
    const body = new Uint8Array([1, 2, 3, 4]);
    const res = mockResponse(body, { 'Content-Length': '4' });
    const got = await readArrayBufferLimited(res, 100, 'test');
    expect(got).toEqual(body);
  });

  it('assertDecodedSize rejects oversized inline payloads', () => {
    expect(() => assertDecodedSize(200, 100, 'inline')).toThrow(NodeApiError);
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
