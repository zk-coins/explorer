/**
 * Parse shareable-link fragments for /tx, /balance, /addr (§5.6–§5.8).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * FRAGMENT-SECRET TRANSPORT (normative, spec §5.6):
 *
 * Bearer secrets (zkview K_tx, zkavk, balance proof / zkatt handle) and every
 * other link component after the app route MUST live in the URL fragment
 * (`#…`) only. A browser never transmits the fragment to the server, so the
 * secret appears in no server log, no proxy, and no Referer.
 *
 * This module MUST only be called from client-side code that reads
 * `window.location.hash`. It MUST NOT:
 *   - put a secret into a query string (`?…`);
 *   - put a secret into a path segment beyond the static app route;
 *   - send a secret (or fragment payload) over the network;
 *   - be invoked during server-side rendering of link contents.
 *
 * Static export + client hydration is the conforming shape: the static HTML
 * for /tx, /balance, /addr carries no fragment; parsing runs only after the
 * browser has the full URL including the hash.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Decryption and proof verification (Authorised / bearer mode) are the next
 * implementation block. After a successful parse this layer returns a typed
 * structure so the UI can show an honest "not yet implemented" state — never
 * an empty success.
 */

import { Bech32mError, decodeBech32m, decodeExplorerBech32m, EXPLORER_HRPS } from '@/lib/bech32m';

export type FragmentParseStatus = 'empty' | 'ok' | 'error';

export interface TxFragmentOk {
  status: 'ok';
  kind: 'tx';
  /** zkbid payload (blob_id). */
  bundle: Uint8Array;
  /** zkview payload (K_tx) — bearer secret; never transmit. */
  view: Uint8Array;
  /** Optional holder hint locator (no secret). */
  holderHint?: string;
}

export interface AddrFragmentOk {
  status: 'ok';
  kind: 'addr';
  /** zk address payload. */
  address: Uint8Array;
  /** zkavk payload (32 or 64 B) — bearer secret; never transmit. */
  avk: Uint8Array;
  avkByteLength: 32 | 64;
  holderHint?: string;
}

export interface BalanceFragmentOk {
  status: 'ok';
  kind: 'balance';
  /** zk address payload. */
  address: Uint8Array;
  /** asset_id as lowercase hex (32 bytes = 64 hex chars) when present. */
  assetIdHex: string;
  /** Attestation form: content-handle (h:) or inline body reference. */
  attestationForm: 'handle' | 'inline';
  /** zkatt payload when form is handle. */
  attestationHandle?: Uint8Array;
  /** Inline body (base64url) when form is inline — not yet decoded further. */
  attestationInline?: string;
  holderHint?: string;
}

export interface FragmentEmpty {
  status: 'empty';
}

export interface FragmentError {
  status: 'error';
  message: string;
}

export type TxFragmentResult = TxFragmentOk | FragmentEmpty | FragmentError;
export type AddrFragmentResult = AddrFragmentOk | FragmentEmpty | FragmentError;
export type BalanceFragmentResult = BalanceFragmentOk | FragmentEmpty | FragmentError;

/** Strip a leading `#` and optional holder-hint suffix `;h=<locator>`. */
function splitHolderHint(fragment: string): { body: string; holderHint?: string } {
  const raw = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  if (raw.length === 0) {
    return { body: '' };
  }
  const marker = ';h=';
  const idx = raw.indexOf(marker);
  if (idx < 0) {
    return { body: raw };
  }
  const body = raw.slice(0, idx);
  const encoded = raw.slice(idx + marker.length);
  if (encoded.length === 0) {
    throw new Bech32mError('holder hint is empty');
  }
  let holderHint: string;
  try {
    holderHint = decodeURIComponent(encoded);
  } catch {
    throw new Bech32mError('holder hint is not valid percent-encoding');
  }
  return { body, holderHint };
}

/**
 * Parse `/tx#<zkbid>/<zkview>[;h=<hint>]`.
 * Wrong HRP on either component is an error (§1.4 / §5.6).
 */
export function parseTxFragment(fragment: string): TxFragmentResult {
  try {
    const { body, holderHint } = splitHolderHint(fragment);
    if (body.length === 0) {
      return { status: 'empty' };
    }
    const parts = body.split('/');
    if (parts.length !== 2) {
      return {
        status: 'error',
        message: 'tx fragment must be <zkbid>/<zkview>',
      };
    }
    const bundleStr = parts[0];
    const viewStr = parts[1];
    if (
      bundleStr === undefined ||
      viewStr === undefined ||
      bundleStr.length === 0 ||
      viewStr.length === 0
    ) {
      return { status: 'error', message: 'tx fragment must be <zkbid>/<zkview>' };
    }
    // Enforce distinct HRPs so locator and key can never be swapped.
    const bundle = decodeExplorerBech32m(bundleStr, EXPLORER_HRPS.zkbid, [32]);
    const view = decodeExplorerBech32m(viewStr, EXPLORER_HRPS.zkview, [32]);
    const result: TxFragmentOk = {
      status: 'ok',
      kind: 'tx',
      bundle,
      view,
    };
    if (holderHint !== undefined) {
      result.holderHint = holderHint;
    }
    return result;
  } catch (err) {
    return {
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Parse `/addr#<zk-address>/<zkavk>[;h=<hint>]`.
 */
export function parseAddrFragment(fragment: string): AddrFragmentResult {
  try {
    const { body, holderHint } = splitHolderHint(fragment);
    if (body.length === 0) {
      return { status: 'empty' };
    }
    const parts = body.split('/');
    if (parts.length !== 2) {
      return {
        status: 'error',
        message: 'addr fragment must be <zk-address>/<zkavk>',
      };
    }
    const addressStr = parts[0];
    const avkStr = parts[1];
    if (
      addressStr === undefined ||
      avkStr === undefined ||
      addressStr.length === 0 ||
      avkStr.length === 0
    ) {
      return { status: 'error', message: 'addr fragment must be <zk-address>/<zkavk>' };
    }
    const address = decodeExplorerBech32m(addressStr, EXPLORER_HRPS.zk, [32]);
    const avk = decodeExplorerBech32m(avkStr, EXPLORER_HRPS.zkavk, [32, 64]);
    const avkByteLength = avk.length === 32 ? 32 : 64;
    const result: AddrFragmentOk = {
      status: 'ok',
      kind: 'addr',
      address,
      avk,
      avkByteLength,
    };
    if (holderHint !== undefined) {
      result.holderHint = holderHint;
    }
    return result;
  } catch (err) {
    return {
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Parse `/balance#<zk-address>/<asset_id>/<attestation>[;h=<hint>]`
 * where attestation is `h:<zkatt>` or `i:<base64url-body>`.
 *
 * Full attestation verification is the next block; this only validates structure
 * and HRPs so wrong prefixes fail loudly.
 */
export function parseBalanceFragment(fragment: string): BalanceFragmentResult {
  try {
    const { body, holderHint } = splitHolderHint(fragment);
    if (body.length === 0) {
      return { status: 'empty' };
    }
    const parts = body.split('/');
    if (parts.length !== 3) {
      return {
        status: 'error',
        message: 'balance fragment must be <zk-address>/<asset_id>/<attestation>',
      };
    }
    const addressStr = parts[0];
    const assetIdHex = parts[1];
    const attestation = parts[2];
    if (
      addressStr === undefined ||
      assetIdHex === undefined ||
      attestation === undefined ||
      addressStr.length === 0 ||
      assetIdHex.length === 0 ||
      attestation.length === 0
    ) {
      return {
        status: 'error',
        message: 'balance fragment must be <zk-address>/<asset_id>/<attestation>',
      };
    }
    const address = decodeExplorerBech32m(addressStr, EXPLORER_HRPS.zk, [32]);
    if (!/^[0-9a-f]{64}$/.test(assetIdHex)) {
      return {
        status: 'error',
        message: 'asset_id must be 64 lowercase hex characters',
      };
    }

    let result: BalanceFragmentOk;
    if (attestation.startsWith('h:')) {
      const handle = attestation.slice(2);
      if (handle.length === 0) {
        return { status: 'error', message: 'balance attestation handle is empty' };
      }
      const attestationHandle = decodeExplorerBech32m(handle, EXPLORER_HRPS.zkatt, [32]);
      result = {
        status: 'ok',
        kind: 'balance',
        address,
        assetIdHex,
        attestationForm: 'handle',
        attestationHandle,
      };
    } else if (attestation.startsWith('i:')) {
      const inline = attestation.slice(2);
      if (inline.length === 0) {
        return { status: 'error', message: 'balance attestation inline body is empty' };
      }
      result = {
        status: 'ok',
        kind: 'balance',
        address,
        assetIdHex,
        attestationForm: 'inline',
        attestationInline: inline,
      };
    } else {
      // A bare zkatt without discriminator is wrong; also catch wrong HRP if someone
      // pasted a raw bech32 under another role.
      if (attestation.includes('1')) {
        const peeked = decodeBech32m(attestation);
        return {
          status: 'error',
          message: `attestation must start with h: or i:; got bare string with HRP ${JSON.stringify(peeked.hrp)}`,
        };
      }
      return {
        status: 'error',
        message: 'attestation must start with h:<zkatt> or i:<base64url>',
      };
    }

    if (holderHint !== undefined) {
      result.holderHint = holderHint;
    }
    return result;
  } catch (err) {
    return {
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Read the browser location hash only. Never call this during SSR of link
 * contents — the fragment is unavailable on the server by design.
 */
export function readLocationHash(): string {
  if (typeof window === 'undefined') {
    // Static export shells have no fragment at build/SSR; client mounts later.
    return '';
  }
  return window.location.hash;
}
