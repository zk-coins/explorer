/**
 * Bounded body reads for untrusted HTTP responses.
 *
 * Enforces the §7.4 / §7.5 `max_blob_bytes` ceiling on Content-Length,
 * streamed transfer size, and (for callers) decoded inline size. Fail-closed:
 * missing/invalid Content-Length is not treated as unlimited.
 */

import { NodeApiError } from '@/lib/api/types';

/**
 * Convert a wire `u64` (bigint) into a safe integer for byte-size gates.
 * Values above `Number.MAX_SAFE_INTEGER` cannot bound a JS allocation — fail closed.
 */
export function u64ToSafeByteLimit(maxBytes: bigint | number, ctx: string): number {
  if (typeof maxBytes === 'bigint') {
    if (maxBytes <= 0n || maxBytes > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(
        `${ctx}: maxBytes must be in (0, MAX_SAFE_INTEGER], got ${maxBytes.toString(10)}`,
      );
    }
    return Number(maxBytes);
  }
  if (
    typeof maxBytes !== 'number' ||
    !Number.isInteger(maxBytes) ||
    maxBytes <= 0 ||
    !Number.isSafeInteger(maxBytes)
  ) {
    throw new Error(`${ctx}: maxBytes must be a positive safe integer, got ${maxBytes}`);
  }
  return maxBytes;
}

/**
 * Read a Response body as bytes, rejecting when:
 * - Content-Length is present and exceeds `maxBytes`
 * - Content-Length is present and mismatches the actual body length
 * - streamed/read bytes exceed `maxBytes`
 */
export async function readArrayBufferLimited(
  res: Response,
  maxBytes: number | bigint,
  ctx: string,
): Promise<Uint8Array> {
  maxBytes = u64ToSafeByteLimit(maxBytes, ctx);

  const clHeader = res.headers.get('content-length');
  if (clHeader !== null) {
    if (!/^\d+$/.test(clHeader)) {
      throw new NodeApiError(
        res.status,
        'malformed_response',
        `${ctx}: invalid Content-Length ${JSON.stringify(clHeader)}`,
      );
    }
    const cl = Number(clHeader);
    if (!Number.isSafeInteger(cl) || cl < 0) {
      throw new NodeApiError(
        res.status,
        'malformed_response',
        `${ctx}: Content-Length out of range: ${clHeader}`,
      );
    }
    if (cl > maxBytes) {
      throw new NodeApiError(
        res.status,
        'blob_too_large',
        `${ctx}: Content-Length ${cl} exceeds max_blob_bytes ${maxBytes}`,
      );
    }
  }

  // Prefer streaming when available so we can abort mid-body.
  if (res.body !== null && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value === undefined) {
        continue;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // cancel best-effort
        }
        throw new NodeApiError(
          res.status,
          'blob_too_large',
          `${ctx}: body exceeds max_blob_bytes ${maxBytes} (read ${total})`,
        );
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    if (clHeader !== null) {
      const cl = Number(clHeader);
      if (out.length !== cl) {
        throw new NodeApiError(
          res.status,
          'malformed_response',
          `${ctx}: body length ${out.length} ≠ Content-Length ${cl}`,
        );
      }
    }
    return out;
  }

  // Fallback when body stream is unavailable (e.g. some test mocks).
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > maxBytes) {
    throw new NodeApiError(
      res.status,
      'blob_too_large',
      `${ctx}: body length ${buf.length} exceeds max_blob_bytes ${maxBytes}`,
    );
  }
  if (clHeader !== null) {
    const cl = Number(clHeader);
    if (buf.length !== cl) {
      throw new NodeApiError(
        res.status,
        'malformed_response',
        `${ctx}: body length ${buf.length} ≠ Content-Length ${cl}`,
      );
    }
  }
  return buf;
}

/** Reject an already-decoded payload larger than max_blob_bytes. */
export function assertDecodedSize(
  byteLength: number,
  maxBytes: number | bigint,
  ctx: string,
): void {
  const limit = u64ToSafeByteLimit(maxBytes, ctx);
  if (!Number.isInteger(byteLength) || byteLength < 0) {
    throw new Error(`${ctx}: byteLength must be a non-negative integer`);
  }
  if (byteLength > limit) {
    throw new NodeApiError(
      200,
      'blob_too_large',
      `${ctx}: decoded size ${byteLength} exceeds max_blob_bytes ${limit}`,
    );
  }
}
