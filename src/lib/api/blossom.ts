/**
 * Blossom blob fetch — §7.4.
 *
 * `GET /blossom/<sha256>` returns raw ciphertext bytes. The client MUST verify
 * `H(body) == sha256` (content-addressed self-check) and reject a mismatch.
 * Ciphertext is already encrypted; the path is unauthenticated.
 *
 * Body size is gated by `max_blob_bytes` from `/v1/info` (Content-Length,
 * streamed bytes). Callers MUST supply the advertised ceiling — no default.
 */

import { NodeApiError } from '@/lib/api/types';
import { readArrayBufferLimited, u64ToSafeByteLimit } from '@/lib/api/bodyLimit';
import { encodeHexLower } from '@/lib/crypto/bytes';
import { sha256 } from '@/lib/crypto/sha256';
import { verifyBlobId } from '@/lib/crypto/zbe';
import { NODE_BASE_URL } from '@/lib/config';

export interface BlossomFetchOpts {
  /** Override Blossom base (holder URL). Defaults to NODE_BASE_URL. */
  baseUrl?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /**
   * §7.4 advertised size ceiling from `/v1/info.max_blob_bytes`.
   * Required — never invent a default limit.
   */
  maxBlobBytes: number | bigint;
}

function resolveBase(baseUrl: string | undefined): string {
  if (baseUrl !== undefined) {
    if (baseUrl.length === 0) {
      throw new Error('blossom base URL must not be empty');
    }
    return baseUrl.replace(/\/+$/, '');
  }
  return NODE_BASE_URL;
}

/**
 * Fetch a blob by content address and verify SHA-256(body) == blobId.
 * Returns the raw body only after the content-address check passes.
 */
export async function fetchBlossomBlob(
  blobId: Uint8Array,
  opts: BlossomFetchOpts,
): Promise<Uint8Array> {
  if (!(blobId instanceof Uint8Array) || blobId.length !== 32) {
    throw new Error(
      `fetchBlossomBlob: blobId must be 32 bytes, got ${blobId instanceof Uint8Array ? blobId.length : typeof blobId}`,
    );
  }
  let maxBlobBytes: number;
  try {
    maxBlobBytes = u64ToSafeByteLimit(opts.maxBlobBytes, 'fetchBlossomBlob.maxBlobBytes');
  } catch (err) {
    const detail =
      err instanceof Error
        ? err.message
        : /* v8 ignore next -- u64ToSafeByteLimit rejects invalid numeric inputs exclusively with Error instances */ String(
            err,
          );
    throw new Error(`fetchBlossomBlob: maxBlobBytes invalid: ${detail}`);
  }
  const hex = encodeHexLower(blobId);
  const base = resolveBase(opts.baseUrl);
  const url = `${base}/blossom/${hex}`;
  const fetchImpl = opts.fetchImpl !== undefined ? opts.fetchImpl : fetch;

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/octet-stream' },
      signal: opts.signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new NodeApiError(0, 'network_error', `Failed to fetch blossom blob: ${msg}`);
  }

  if (!res.ok) {
    throw new NodeApiError(
      res.status,
      res.status === 404 ? 'not_found' : 'http_error',
      `Blossom GET /blossom/${hex} → HTTP ${res.status}`,
    );
  }

  const buf = await readArrayBufferLimited(res, opts.maxBlobBytes, `blossom/${hex}`);
  if (!verifyBlobId(buf, blobId)) {
    const actual = encodeHexLower(sha256(buf));
    throw new NodeApiError(
      200,
      'blob_id_mismatch',
      `Blossom body SHA-256 ${actual} does not match blob_id ${hex}`,
    );
  }
  return buf;
}

/**
 * Try an ordered list of Blossom bases; return the first successful fetch.
 * Every failure is collected; if all fail, throw with the last error.
 */
export async function fetchBlossomBlobFromHolders(
  blobId: Uint8Array,
  holders: string[],
  opts: Omit<BlossomFetchOpts, 'baseUrl'>,
): Promise<{ body: Uint8Array; holder: string }> {
  if (holders.length === 0) {
    throw new Error('fetchBlossomBlobFromHolders: holders list is empty');
  }
  let lastErr: unknown;
  for (const holder of holders) {
    try {
      const body = await fetchBlossomBlob(blobId, { ...opts, baseUrl: holder });
      return { body, holder };
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr instanceof Error) {
    throw lastErr;
  }
  throw new Error('fetchBlossomBlobFromHolders: all holders failed');
}
