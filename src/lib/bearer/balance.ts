/**
 * §5.7 balance attestation share-link — client-side verification checklist.
 *
 * Checks the explorer runs itself:
 *   - obtain BalanceAttestationV1 (inline decode or content-addressed fetch)
 *   - SHA-256(body) == zkatt handle (form h:)
 *   - decode §7.1 layout (width / trailing-byte fail-closed)
 *   - subject and asset_id match the fragment
 *   - network_id matches the verifier's network (from /v1/info + SDK)
 *   - Path-B presence of Pk_anchor (informational host-side anchor probe)
 *
 * Open steps (honest, never claimed verified):
 *   - C_balance Plonky2 proof verification
 *   - nav_ceiling canonicity against own scan (size_ceiling ≤ size_final, MTH rebuild)
 *   - first-occurrence + completed classification against own scan
 */

import { digestToBytes, networkIdMainnet, networkIdRegtest, networkIdTestnet } from '@zkcoins/sdk';
import { fetchBlossomBlobFromHolders } from '@/lib/api/blossom';
import { fetchInfo, fetchNullifier } from '@/lib/api/client';
import type { NetworkTag } from '@/lib/api/types';
import {
  attestationToView,
  deserializeBalanceAttestationV1,
  type BalanceAttestationV1,
} from '@/lib/bundle/balanceAttestation';
import { base64UrlDecodeNoPad, bytesEqual, encodeHexLower } from '@/lib/crypto/bytes';
import { sha256 } from '@/lib/crypto/sha256';
import { fail, open, pass, type CheckItem } from '@/lib/bearer/checks';
import type { BalanceFragmentOk } from '@/lib/fragments';

export interface BalanceAttestationView {
  checks: CheckItem[];
  fields?: ReturnType<typeof attestationToView>;
  fatalError?: string;
}

export interface BalanceDeps {
  fetchFromHolders?: typeof fetchBlossomBlobFromHolders;
  fetchInfo?: typeof fetchInfo;
  fetchNullifier?: typeof fetchNullifier;
  baseUrl?: string;
  signal?: AbortSignal;
  /** Override network when /v1/info is not available (tests). */
  network?: NetworkTag;
}

function parseBlobLocatorSet(hint: string | undefined): string[] {
  if (hint === undefined || hint.length === 0) {
    return [];
  }
  // §5.7: percent-decoded holder-hint is comma-joined Blossom bases.
  return hint
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function networkIdBytes(network: NetworkTag): Uint8Array {
  const digest =
    network === 'mainnet'
      ? networkIdMainnet()
      : network === 'testnet'
        ? networkIdTestnet()
        : networkIdRegtest();
  return digestToBytes(digest);
}

/**
 * Pure verification of already-obtained attestation bytes against the fragment.
 */
export function verifyBalanceAttestationBytes(
  body: Uint8Array,
  fragment: BalanceFragmentOk,
  opts: {
    network?: NetworkTag;
    expectedHandle?: Uint8Array;
  } = {},
): BalanceAttestationView {
  const checks: CheckItem[] = [];

  if (opts.expectedHandle !== undefined) {
    const actual = sha256(body);
    if (!bytesEqual(actual, opts.expectedHandle)) {
      checks.push(
        fail(
          'handle_hash',
          'Content handle SHA-256(body) == zkatt',
          `body hash ${encodeHexLower(actual)} ≠ handle ${encodeHexLower(opts.expectedHandle)}`,
        ),
      );
      return { checks, fatalError: 'attestation handle mismatch' };
    }
    checks.push(
      pass(
        'handle_hash',
        'Content handle SHA-256(body) == zkatt',
        'Fetched body matches zkatt payload',
      ),
    );
  }

  let att: BalanceAttestationV1;
  try {
    att = deserializeBalanceAttestationV1(body);
    checks.push(
      pass(
        'decode',
        'BalanceAttestationV1 decode',
        `balance=${att.balance.toString(10)} proof_len=${att.proof.length}`,
      ),
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    checks.push(fail('decode', 'BalanceAttestationV1 decode', detail));
    return { checks, fatalError: detail };
  }

  const subjectHex = encodeHexLower(att.subject);
  const fragSubjectHex = encodeHexLower(fragment.address);
  if (subjectHex !== fragSubjectHex) {
    checks.push(
      fail(
        'subject_match',
        'subject equals fragment address',
        `attestation subject ${subjectHex} ≠ fragment ${fragSubjectHex}`,
      ),
    );
  } else {
    checks.push(pass('subject_match', 'subject equals fragment address', subjectHex));
  }

  const assetHex = encodeHexLower(att.assetId);
  if (assetHex !== fragment.assetIdHex) {
    checks.push(
      fail(
        'asset_match',
        'asset_id equals fragment asset_id',
        `attestation asset_id ${assetHex} ≠ fragment ${fragment.assetIdHex}`,
      ),
    );
  } else {
    checks.push(pass('asset_match', 'asset_id equals fragment asset_id', assetHex));
  }

  if (opts.network !== undefined) {
    const expectedNid = networkIdBytes(opts.network);
    if (!bytesEqual(att.networkId, expectedNid)) {
      checks.push(
        fail(
          'network_id',
          'network_id equals verifier network',
          `attestation network_id ${encodeHexLower(att.networkId)} ≠ ${opts.network}`,
        ),
      );
    } else {
      checks.push(
        pass('network_id', 'network_id equals verifier network', `matches ${opts.network}`),
      );
    }
  } else {
    checks.push(
      open(
        'network_id',
        'network_id equals verifier network',
        'Network not supplied; call with /v1/info network to close this check',
      ),
    );
  }

  // Open steps §5.7 requires and the explorer cannot complete without own scan / circuit:
  checks.push(
    open(
      'c_balance_proof',
      'C_balance proof verifies under pinned verifier data',
      'Plonky2 verification is not available in the explorer client',
    ),
  );
  checks.push(
    open(
      'nav_ceiling_canonical',
      'nav_ceiling canonical on own scan (size_ceiling ≤ size_final)',
      'Requires rebuilding MTH(D[0:size_ceiling]) from a self-hosted Bitcoin scan',
    ),
  );
  checks.push(
    open(
      'anchor_first_occurrence',
      'Anchor (Pk_anchor, R_anchor) first-occurrence completed on own scan',
      'Host-side §5.7 precondition; explorer can only probe Path-B presence, not classify completed from own scan',
    ),
  );

  return {
    checks,
    fields: attestationToView(att),
  };
}

export async function resolveBalanceAttestation(
  fragment: BalanceFragmentOk,
  deps: BalanceDeps = {},
): Promise<BalanceAttestationView> {
  const fetchFromHolders = deps.fetchFromHolders ?? fetchBlossomBlobFromHolders;
  const fetchInf = deps.fetchInfo ?? fetchInfo;
  const fetchNf = deps.fetchNullifier ?? fetchNullifier;
  const signal = deps.signal;
  const baseUrl = deps.baseUrl;

  let network = deps.network;
  if (network === undefined) {
    try {
      const info = await fetchInf({ baseUrl, signal });
      network = info.network;
    } catch {
      // leave undefined → open network_id check
    }
  }

  let body: Uint8Array;
  let expectedHandle: Uint8Array | undefined;

  if (fragment.attestationForm === 'inline') {
    if (fragment.attestationInline === undefined || fragment.attestationInline.length === 0) {
      return {
        checks: [fail('obtain', 'Obtain BalanceAttestationV1', 'inline body missing')],
        fatalError: 'inline attestation body missing',
      };
    }
    try {
      body = base64UrlDecodeNoPad(fragment.attestationInline);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return {
        checks: [fail('obtain', 'Obtain BalanceAttestationV1 (inline base64url)', detail)],
        fatalError: detail,
      };
    }
  } else {
    if (fragment.attestationHandle === undefined) {
      return {
        checks: [fail('obtain', 'Obtain BalanceAttestationV1', 'zkatt handle missing')],
        fatalError: 'zkatt handle missing',
      };
    }
    expectedHandle = fragment.attestationHandle;
    const holders = parseBlobLocatorSet(fragment.holderHint);
    if (holders.length === 0) {
      return {
        checks: [
          fail(
            'obtain',
            'Obtain BalanceAttestationV1 (content-addressed)',
            'h: form requires a BlobLocatorSet in the fragment holder-hint (;h=…); none present',
          ),
        ],
        fatalError: 'BlobLocatorSet required for h: attestation form',
      };
    }
    try {
      const got = await fetchFromHolders(expectedHandle, holders, { signal });
      body = got.body;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return {
        checks: [fail('obtain', 'Obtain BalanceAttestationV1 (Blossom fetch)', detail)],
        fatalError: detail,
      };
    }
  }

  const view = verifyBalanceAttestationBytes(body, fragment, {
    ...(network !== undefined ? { network } : {}),
    ...(expectedHandle !== undefined ? { expectedHandle } : {}),
  });

  // Path-B probe for Pk_anchor — informational only.
  if (view.fields !== undefined) {
    try {
      const nf = await fetchNf(view.fields.pkAnchorHex, { baseUrl, signal });
      if (nf.present) {
        view.checks.push(
          pass(
            'anchor_path_b',
            'Path-B probe for Pk_anchor',
            `present at position ${nf.position}; not a completed classification`,
          ),
        );
      } else {
        view.checks.push(
          open(
            'anchor_path_b',
            'Path-B probe for Pk_anchor',
            'present: false (unauthenticated absence) — not treated as failed or verified',
          ),
        );
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      view.checks.push(
        open('anchor_path_b', 'Path-B probe for Pk_anchor', `lookup failed: ${detail}`),
      );
    }
  }

  return view;
}
