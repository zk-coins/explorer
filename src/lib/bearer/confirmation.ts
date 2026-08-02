/**
 * §5.6 shareable confirmation link — client-side flow.
 *
 * 1. Fetch CoinProof ZBE blob by blob_id (zkbid)
 * 2. Content-address check: H(ciphertext) == blob_id
 * 3. ZBE-open under K_tx (zkview)
 * 4. Deserialize CoinProof; render coin fields
 * 5. Anchoring trail: creating_nullifier → Path-B / inscriptions → §3.10 state
 *
 * Status shown is the §3.10 state from node data — never a client classification.
 */

import { fetchBlossomBlob, fetchBlossomBlobFromHolders } from '@/lib/api/blossom';
import { fetchInfo, fetchInscriptions, fetchNullifier } from '@/lib/api/client';
import type { NullifierState } from '@/lib/api/types';
import { coinToView, deserializeCoinProof, type CoinProof } from '@/lib/bundle/coinProof';
import { encodeHexLower } from '@/lib/crypto/bytes';
import { verifyBlobId, ZbeError, zbeOpen } from '@/lib/crypto/zbe';
import { fail, open, pass, type CheckItem } from '@/lib/bearer/checks';
import { stateFromInscriptions } from '@/lib/bearer/stateFromNode';
import type { TxFragmentOk } from '@/lib/fragments';

export interface ConfirmationView {
  checks: CheckItem[];
  coin?: ReturnType<typeof coinToView>;
  creatingNullifier?: {
    pkCreateHex: string;
    rCreateHex: string;
    rPrimeCreateHex: string;
  };
  navOpening?: {
    size: string;
    mthHex: string;
  };
  /** §3.10 state from node data when available; never invented. */
  state?: NullifierState;
  anchoring?: {
    tipHeight?: number;
    tipBlockHash?: string;
    nullifierPresent?: boolean;
    position?: number;
    /** Reveal txid when found in the inscription stream. */
    revealTxid?: string;
    height?: number;
    confirmations?: number;
  };
  assetTermsName?: string;
  fatalError?: string;
}

export interface ConfirmationDeps {
  fetchBlob?: typeof fetchBlossomBlob;
  fetchBlobFromHolders?: typeof fetchBlossomBlobFromHolders;
  fetchNullifier?: typeof fetchNullifier;
  fetchInscriptions?: typeof fetchInscriptions;
  fetchInfo?: typeof fetchInfo;
  baseUrl?: string;
  signal?: AbortSignal;
}

function parseHolderHint(hint: string | undefined): string[] {
  if (hint === undefined || hint.length === 0) {
    return [];
  }
  // §5.6 holder hint: `op:<pk>` or `@<relay-url>` — only `@http(s)://…` is a
  // Blossom base we can GET. Comma-separated bases (as in §5.7 BlobLocatorSet)
  // are also accepted when a producer re-uses the same suffix form.
  if (hint.startsWith('@')) {
    const url = hint.slice(1);
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return [url];
    }
    return [];
  }
  if (hint.includes(',')) {
    return hint
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.startsWith('http://') || s.startsWith('https://'));
  }
  if (hint.startsWith('http://') || hint.startsWith('https://')) {
    return [hint];
  }
  return [];
}

/**
 * Pure open of an already-fetched ZBE body. Used by the full flow and by tests.
 */
export function openConfirmationBlob(
  kTx: Uint8Array,
  ciphertext: Uint8Array,
  expectedBlobId: Uint8Array,
): { checks: CheckItem[]; coinProof?: CoinProof; fatalError?: string } {
  const checks: CheckItem[] = [];

  if (!verifyBlobId(ciphertext, expectedBlobId)) {
    checks.push(
      fail(
        'blob_id',
        'Content-address match',
        'SHA-256(ciphertext) does not equal zkbid payload — blob rejected',
      ),
    );
    return {
      checks,
      fatalError: 'blob_id mismatch: ciphertext does not match zkbid',
    };
  }
  checks.push(pass('blob_id', 'Content-address match', 'SHA-256(ciphertext) == zkbid payload'));

  let plaintext: Uint8Array;
  try {
    plaintext = zbeOpen(kTx, ciphertext);
    checks.push(pass('zbe_open', 'ZBE open under zkview (K_tx)', 'All chunks authenticated'));
  } catch (err) {
    const detail =
      err instanceof ZbeError
        ? `${err.code}${err.chunkIndex !== undefined ? ` (chunk ${err.chunkIndex})` : ''}: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    checks.push(fail('zbe_open', 'ZBE open under zkview (K_tx)', detail));
    return { checks, fatalError: detail };
  }

  try {
    const coinProof = deserializeCoinProof(plaintext);
    checks.push(
      pass(
        'coinproof_decode',
        'CoinProof decode',
        `coin identifier ${encodeHexLower(coinProof.coin.identifier).slice(0, 16)}…`,
      ),
    );
    return { checks, coinProof };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    checks.push(fail('coinproof_decode', 'CoinProof decode', detail));
    return { checks, fatalError: detail };
  }
}

export async function resolveConfirmationLink(
  fragment: TxFragmentOk,
  deps: ConfirmationDeps = {},
): Promise<ConfirmationView> {
  const fetchBlob = deps.fetchBlob ?? fetchBlossomBlob;
  const fetchFromHolders = deps.fetchBlobFromHolders ?? fetchBlossomBlobFromHolders;
  const fetchNf = deps.fetchNullifier ?? fetchNullifier;
  const fetchInsc = deps.fetchInscriptions ?? fetchInscriptions;
  const fetchInf = deps.fetchInfo ?? fetchInfo;
  const signal = deps.signal;
  const baseUrl = deps.baseUrl;

  const checks: CheckItem[] = [];
  const holders = parseHolderHint(fragment.holderHint);

  let ciphertext: Uint8Array;
  try {
    if (holders.length > 0) {
      const got = await fetchFromHolders(fragment.bundle, holders, { signal });
      ciphertext = got.body;
      checks.push(
        pass('fetch_blob', 'Fetch ZBE blob (Blossom)', `Fetched from holder ${got.holder}`),
      );
    } else {
      ciphertext = await fetchBlob(fragment.bundle, { baseUrl, signal });
      checks.push(pass('fetch_blob', 'Fetch ZBE blob (Blossom)', 'Fetched from node Blossom base'));
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    checks.push(fail('fetch_blob', 'Fetch ZBE blob (Blossom)', detail));
    return { checks, fatalError: detail };
  }

  const opened = openConfirmationBlob(fragment.view, ciphertext, fragment.bundle);
  checks.push(...opened.checks);
  if (opened.coinProof === undefined) {
    return { checks, fatalError: opened.fatalError };
  }
  const cp = opened.coinProof;

  const coin = coinToView(cp.coin);
  const creatingNullifier = {
    pkCreateHex: encodeHexLower(cp.creatingNullifier.pkCreate),
    rCreateHex: encodeHexLower(cp.creatingNullifier.rCreate),
    rPrimeCreateHex: encodeHexLower(cp.creatingNullifier.rPrimeCreate),
  };
  const navOpening = {
    size: cp.navOpening.size.toString(10),
    mthHex: encodeHexLower(cp.navOpening.mth),
  };

  checks.push(
    pass(
      'coin_fields',
      'Coin fields present',
      `amount=${coin.amount} asset_id=${coin.assetIdHex.slice(0, 16)}…`,
    ),
  );

  // Open steps the explorer cannot run in-browser:
  checks.push(
    open(
      'plonky2_proof',
      'Recursive validity proof (Plonky2)',
      'Explorer does not run the C verifier in-browser; proof bytes are carried but not checked here',
    ),
  );
  checks.push(
    open(
      'inclusion_proof',
      'Coin membership in output_coins_root',
      'Inclusion-proof verification against ocr is not performed client-side in this block',
    ),
  );
  checks.push(
    open(
      'nav_canonical',
      'nav opening canonical on own scan',
      'Requires rebuilding the nullifier accumulator from Bitcoin; explorer uses the node Path-B surface only',
    ),
  );
  checks.push(
    open(
      's2c_binding',
      'R_create S2C-opens H(creating ProofData) and Pk_create == consumed_pubkey',
      'Requires verifying the creating proof public inputs; not done client-side here',
    ),
  );

  const anchoring: ConfirmationView['anchoring'] = {};
  let state: NullifierState | undefined;
  try {
    const nf = await fetchNf(creatingNullifier.pkCreateHex, { baseUrl, signal });
    anchoring.tipHeight = nf.tip_height;
    anchoring.tipBlockHash = nf.tip_block_hash;
    anchoring.nullifierPresent = nf.present;
    if (nf.present && nf.position !== undefined) {
      anchoring.position = nf.position;
      checks.push(
        pass(
          'nullifier_path_b',
          'Path-B nullifier lookup (creating Pk)',
          `present at position ${nf.position}; tip_height=${nf.tip_height}`,
        ),
      );
      if (nf.leaf !== undefined && nf.leaf === creatingNullifier.rCreateHex) {
        checks.push(
          pass(
            'nullifier_r_match',
            'Path-B leaf R equals R_create',
            'Node leaf matches creating_nullifier.R_create',
          ),
        );
      } else if (nf.leaf !== undefined) {
        checks.push(
          fail(
            'nullifier_r_match',
            'Path-B leaf R equals R_create',
            `Node leaf ${nf.leaf} ≠ R_create ${creatingNullifier.rCreateHex}`,
          ),
        );
      }
    } else {
      checks.push(
        pass(
          'nullifier_path_b',
          'Path-B nullifier lookup (creating Pk)',
          'present: false — unauthenticated local-index absence (not non-inclusion)',
        ),
      );
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    checks.push(fail('nullifier_path_b', 'Path-B nullifier lookup (creating Pk)', detail));
  }

  try {
    // tip for confirmations comes from Path-B (tip_height), not from /v1/info.
    await fetchInf({ baseUrl, signal });
    const insc = await fetchInsc({ limit: 200, baseUrl, signal });
    const hit = stateFromInscriptions(creatingNullifier.pkCreateHex, insc.inscriptions);
    if (hit !== undefined) {
      state = hit.state;
      anchoring.revealTxid = hit.txid;
      anchoring.height = hit.height;
      if (anchoring.tipHeight !== undefined) {
        anchoring.confirmations = anchoring.tipHeight - hit.height + 1;
      }
      checks.push(
        pass(
          'state_310',
          '§3.10 state (from node inscription data)',
          `state=${hit.state} reveal_txid=${hit.txid} height=${hit.height}`,
        ),
      );
    } else {
      checks.push(
        open(
          'state_310',
          '§3.10 state (from node inscription data)',
          'Creating Pk not found in the fetched inscription page — state not asserted; scan deeper or self-host a full scan',
        ),
      );
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    checks.push(
      open(
        'state_310',
        '§3.10 state (from node inscription data)',
        `Could not load inscriptions: ${detail}`,
      ),
    );
  }

  let assetTermsName: string | undefined;
  if (cp.assetTerms !== undefined) {
    try {
      assetTermsName = new TextDecoder('utf-8', { fatal: true }).decode(cp.assetTerms.name);
    } catch {
      assetTermsName = undefined;
    }
  }

  const view: ConfirmationView = {
    checks,
    coin,
    creatingNullifier,
    navOpening,
    anchoring,
  };
  if (state !== undefined) {
    view.state = state;
  }
  if (assetTermsName !== undefined) {
    view.assetTermsName = assetTermsName;
  }
  return view;
}
