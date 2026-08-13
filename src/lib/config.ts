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
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(
      `NEXT_PUBLIC_NODE_BASE_URL is not a valid absolute URL, got ${JSON.stringify(raw)}`,
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `NEXT_PUBLIC_NODE_BASE_URL must use http or https protocol, got ${JSON.stringify(raw)}`,
    );
  }
  // WHATWG rejects empty hosts on http(s) before this check can run.
  /* v8 ignore next -- empty http(s) host is a parse failure, not a parsed empty hostname */
  if (!parsed.hostname) {
    throw new Error(
      `NEXT_PUBLIC_NODE_BASE_URL hostname must be non-empty, got ${JSON.stringify(raw)}`,
    );
  }
  if (parsed.username || parsed.password) {
    throw new Error(
      `NEXT_PUBLIC_NODE_BASE_URL must not include userinfo credentials, got ${JSON.stringify(raw)}`,
    );
  }
  if (parsed.search) {
    throw new Error(
      `NEXT_PUBLIC_NODE_BASE_URL must not include a query string, got ${JSON.stringify(raw)}`,
    );
  }
  if (parsed.hash) {
    throw new Error(
      `NEXT_PUBLIC_NODE_BASE_URL must not include a fragment, got ${JSON.stringify(raw)}`,
    );
  }
  // Strip trailing slashes so path joins are unambiguous.
  return raw.replace(/\/+$/, '');
}

/** Absolute origin of the node REST surface the explorer reads (no trailing slash). */
export const NODE_BASE_URL: string = readNodeBaseUrl();
