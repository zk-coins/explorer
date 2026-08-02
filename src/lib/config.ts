/**
 * Build-time node/API base URL.
 *
 * NEXT_PUBLIC_NODE_BASE_URL is required (enforced in next.config.js at build).
 * There is intentionally no runtime default host — pointing at the wrong node
 * silently would violate the fail-closed rule.
 */

function readNodeBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_NODE_BASE_URL;
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('NEXT_PUBLIC_NODE_BASE_URL is not set. The explorer has no default node URL.');
  }
  if (!/^https?:\/\//.test(raw)) {
    throw new Error(
      `NEXT_PUBLIC_NODE_BASE_URL must start with http:// or https://, got ${JSON.stringify(raw)}`,
    );
  }
  // Strip trailing slashes so path joins are unambiguous.
  return raw.replace(/\/+$/, '');
}

/** Absolute origin of the node REST surface the explorer reads (no trailing slash). */
export const NODE_BASE_URL: string = readNodeBaseUrl();
