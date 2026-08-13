/**
 * §5.6 shareable confirmation link — client-side flow.
 *
 * 1. Fetch CoinProof ZBE blob by blob_id (zkbid)
 * 2. Content-address check: H(ciphertext) == blob_id
 * 3. ZBE-open under K_tx (zkview)
 * 4. Deserialize CoinProof (width + semantic checks); render coin fields
 * 5. Anchoring trail: creating_nullifier → Path-B / inscriptions → §3.10 state
 *
 * Status shown is the §3.10 state from node data — never a client classification.
 * Path-B `present: false` is unauthenticated absence → check stays `open`, never `pass`.
 */

import { fetchBlossomBlob, fetchBlossomBlobFromHolders } from '@/lib/api/blossom';
import { fetchInfo, fetchInscriptions, fetchNullifier } from '@/lib/api/client';
import { NodeApiError, type NullifierState } from '@/lib/api/types';
import { coinToView, deserializeCoinProof, type CoinProof } from '@/lib/bundle/coinProof';
import { encodeHexLower } from '@/lib/crypto/bytes';
import { verifyBlobId, ZbeError, zbeOpen } from '@/lib/crypto/zbe';
import { fail, open, pass, type CheckItem } from '@/lib/bearer/checks';
import { parseHolderLocators } from '@/lib/bearer/httpLocator';
import { stateFromInscriptions } from '@/lib/bearer/stateFromNode';
import type { TxFragmentOk } from '@/lib/fragments';

const INSCRIPTION_PAGE_LIMIT = 200;
const INSCRIPTION_MAX_PAGES = 50;

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
    tipHeight?: bigint;
    tipBlockHash?: string;
    nullifierPresent?: boolean;
    position?: bigint;
    /** Reveal txid when found in the inscription stream. */
    revealTxid?: string;
    height?: bigint;
    confirmations?: bigint;
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
  /** Max inscription pages to scan for creating Pk (default 50). */
  maxInscriptionPages?: number;
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
    let detail: string;
    /* v8 ignore else -- verifyBlobId's noble SHA-256 call rejects non-Uint8Array ciphertext before zbeOpen; after that, requireKey32 and every framing/auth failure in zbeOpen throw ZbeError */
    if (err instanceof ZbeError) {
      detail = `${err.code}${err.chunkIndex !== undefined ? ` (chunk ${err.chunkIndex})` : ''}: ${err.message}`;
    } else {
      detail = err instanceof Error ? err.message : String(err);
    }
    checks.push(fail('zbe_open', 'ZBE open under zkview (K_tx)', detail));
    return { checks, fatalError: detail };
  }

  try {
    const coinProof = deserializeCoinProof(plaintext);
    checks.push(
      pass(
        'coinproof_decode',
        'CoinProof decode (width + digests/points/asset_id)',
        `coin identifier ${encodeHexLower(coinProof.coin.identifier).slice(0, 16)}…`,
      ),
    );
    return { checks, coinProof };
  } catch (err) {
    const detail =
      err instanceof Error
        ? err.message
        : /* v8 ignore next -- deserializeCoinProof reports every malformed proof with CoinProofError */ String(
            err,
          );
    checks.push(
      fail('coinproof_decode', 'CoinProof decode (width + digests/points/asset_id)', detail),
    );
    return { checks, fatalError: detail };
  }
}

/**
 * Walk inscription cursor pages until the exact creating nullifier pair
 * `(Pk_create, R_create)` is found or pages are exhausted.
 */
export async function findCreatingPkInInscriptions(
  pkHex: string,
  rHex: string,
  fetchInsc: typeof fetchInscriptions,
  opts: {
    baseUrl?: string;
    signal?: AbortSignal;
    pageLimit: number;
    maxPages: number;
  },
): Promise<{ hit?: ReturnType<typeof stateFromInscriptions>; pagesScanned: number }> {
  let from_height: bigint | undefined;
  let from_tx_index: number | undefined;
  let from_vin_index: number | undefined;
  let pagesScanned = 0;

  for (let page = 0; page < opts.maxPages; page++) {
    const insc = await fetchInsc({
      limit: opts.pageLimit,
      ...(from_height !== undefined ? { from_height } : {}),
      ...(from_tx_index !== undefined ? { from_tx_index } : {}),
      ...(from_vin_index !== undefined ? { from_vin_index } : {}),
      baseUrl: opts.baseUrl,
      signal: opts.signal,
    });
    pagesScanned += 1;
    const hit = stateFromInscriptions(pkHex, rHex, insc.inscriptions);
    if (hit !== undefined) {
      return { hit, pagesScanned };
    }
    if (
      insc.next_height === undefined ||
      insc.next_tx_index === undefined ||
      insc.next_vin_index === undefined
    ) {
      break;
    }
    from_height = insc.next_height;
    from_tx_index = insc.next_tx_index;
    from_vin_index = insc.next_vin_index;
  }

  return { pagesScanned };
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
  const maxInscriptionPages =
    deps.maxInscriptionPages !== undefined ? deps.maxInscriptionPages : INSCRIPTION_MAX_PAGES;

  const checks: CheckItem[] = [];
  const parsedHolders = parseHolderLocators(fragment.holderHint);
  if (parsedHolders.status === 'invalid') {
    return {
      checks: [fail('fetch_blob', 'Fetch ZBE blob (Blossom)', parsedHolders.detail)],
      fatalError: parsedHolders.detail,
    };
  }
  const holders = parsedHolders.status === 'ok' ? parsedHolders.locators : [];

  // max_blob_bytes is required before any untrusted body load.
  let maxBlobBytes: number | bigint;
  try {
    const info = await fetchInf({ baseUrl, signal });
    maxBlobBytes = info.max_blob_bytes;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    checks.push(fail('node_info', 'GET /v1/info (max_blob_bytes)', detail));
    return { checks, fatalError: `GET /v1/info failed: ${detail}` };
  }
  checks.push(
    pass(
      'node_info',
      'GET /v1/info (max_blob_bytes)',
      `max_blob_bytes=${maxBlobBytes.toString(10)}`,
    ),
  );

  let ciphertext: Uint8Array;
  try {
    if (holders.length > 0) {
      const got = await fetchFromHolders(fragment.bundle, holders, {
        signal,
        maxBlobBytes,
      });
      ciphertext = got.body;
      checks.push(
        pass('fetch_blob', 'Fetch ZBE blob (Blossom)', `Fetched from holder ${got.holder}`),
      );
    } else {
      ciphertext = await fetchBlob(fragment.bundle, { baseUrl, signal, maxBlobBytes });
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
    pass('coin_fields', 'Coin fields present', `asset_id=${coin.assetIdHex.slice(0, 16)}…`),
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
  let fatalError: string | undefined;
  // Path-B inconsistency makes chain state unusable — never set state/confirmations from inscriptions.
  let pathBRMismatch = false;
  let pathBFailureReason = '';
  try {
    const nf = await fetchNf(creatingNullifier.pkCreateHex, { baseUrl, signal });
    anchoring.tipHeight = nf.tip_height;
    anchoring.tipBlockHash = nf.tip_block_hash;
    anchoring.nullifierPresent = nf.present;
    if (nf.present === true) {
      // PASS only when position and leaf are set and leaf binds to R_create.
      if (
        nf.position === undefined ||
        nf.leaf === undefined ||
        nf.leaf !== creatingNullifier.rCreateHex
      ) {
        pathBRMismatch = true;
        if (nf.position !== undefined) {
          anchoring.position = nf.position;
        }
        if (nf.position === undefined) {
          pathBFailureReason = 'Path-B present without position — cannot bind to R_create';
          fatalError = pathBFailureReason;
          checks.push(
            fail(
              'nullifier_path_b',
              'Path-B nullifier lookup (creating Pk)',
              'present without position — cannot bind to R_create',
            ),
          );
          checks.push(
            fail(
              'nullifier_r_match',
              'Path-B leaf R equals R_create',
              'present without position — cannot bind to R_create',
            ),
          );
        } else if (nf.leaf === undefined) {
          pathBFailureReason = 'Path-B present without leaf — cannot bind to R_create';
          fatalError = pathBFailureReason;
          checks.push(
            fail(
              'nullifier_path_b',
              'Path-B nullifier lookup (creating Pk)',
              'present without leaf — cannot bind to R_create',
            ),
          );
          checks.push(
            fail(
              'nullifier_r_match',
              'Path-B leaf R equals R_create',
              'present without leaf — cannot bind to R_create',
            ),
          );
        } else {
          pathBFailureReason = `Path-B leaf ${nf.leaf} ≠ R_create ${creatingNullifier.rCreateHex}`;
          fatalError = pathBFailureReason;
          checks.push(
            fail(
              'nullifier_path_b',
              'Path-B nullifier lookup (creating Pk)',
              `present at position ${nf.position} but leaf does not bind to R_create`,
            ),
          );
          checks.push(
            fail(
              'nullifier_r_match',
              'Path-B leaf R equals R_create',
              `Node leaf ${nf.leaf} ≠ R_create ${creatingNullifier.rCreateHex}`,
            ),
          );
        }
      } else {
        anchoring.position = nf.position;
        checks.push(
          pass(
            'nullifier_path_b',
            'Path-B nullifier lookup (creating Pk)',
            `present at position ${nf.position}; tip_height=${nf.tip_height}`,
          ),
        );
        checks.push(
          pass(
            'nullifier_r_match',
            'Path-B leaf R equals R_create',
            'Node leaf matches creating_nullifier.R_create',
          ),
        );
      }
    } else {
      // present: false is unauthenticated local-index absence — not verified inclusion.
      checks.push(
        open(
          'nullifier_path_b',
          'Path-B nullifier lookup (creating Pk)',
          'present: false — unauthenticated local-index absence (not non-inclusion); inclusion not verified',
        ),
      );
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    checks.push(fail('nullifier_path_b', 'Path-B nullifier lookup (creating Pk)', detail));
    // Malformed wire (present:true without position/leaf) is fail-closed: do not set state from inscriptions.
    if (err instanceof NodeApiError && err.code === 'malformed_response') {
      pathBFailureReason = detail;
      fatalError = detail;
      pathBRMismatch = true;
    }
  }

  if (pathBRMismatch) {
    checks.push(
      fail(
        'state_310',
        '§3.10 state (from node inscription data)',
        `Skipped: ${pathBFailureReason} — state not asserted from inscriptions under inconsistent chain data`,
      ),
    );
  } else {
    try {
      const { hit, pagesScanned } = await findCreatingPkInInscriptions(
        creatingNullifier.pkCreateHex,
        creatingNullifier.rCreateHex,
        fetchInsc,
        { baseUrl, signal, pageLimit: INSCRIPTION_PAGE_LIMIT, maxPages: maxInscriptionPages },
      );
      if (hit !== undefined) {
        if (anchoring.tipHeight !== undefined && hit.height > anchoring.tipHeight) {
          fatalError = `reveal height ${hit.height.toString(10)} > tip_height ${anchoring.tipHeight.toString(10)}`;
          checks.push(
            fail(
              'state_310',
              '§3.10 state (from node inscription data)',
              `reveal height ${hit.height.toString(10)} > tip_height ${anchoring.tipHeight.toString(10)} — inconsistent chain tip`,
            ),
          );
        } else {
          state = hit.state;
          anchoring.revealTxid = hit.txid;
          anchoring.height = hit.height;
          if (anchoring.tipHeight !== undefined) {
            anchoring.confirmations = anchoring.tipHeight - hit.height + 1n;
          }
          checks.push(
            pass(
              'state_310',
              '§3.10 state (from node inscription data)',
              `state=${hit.state} reveal_txid=${hit.txid} height=${hit.height.toString(10)} (pages=${pagesScanned})`,
            ),
          );
        }
      } else {
        checks.push(
          open(
            'state_310',
            '§3.10 state (from node inscription data)',
            `Creating (Pk, R) pair not found after scanning ${pagesScanned} inscription page(s) — state not asserted`,
          ),
        );
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (err instanceof NodeApiError && err.code === 'malformed_response') {
        fatalError = detail;
        checks.push(fail('state_310', '§3.10 state (from node inscription data)', detail));
      } else {
        checks.push(
          open(
            'state_310',
            '§3.10 state (from node inscription data)',
            `Could not load inscriptions: ${detail}`,
          ),
        );
      }
    }
  }

  // Asset name only after semantic decode (asset_id recompute already ran when terms present).
  let assetTermsName: string | undefined;
  if (cp.assetTerms !== undefined) {
    try {
      assetTermsName = new TextDecoder('utf-8', { fatal: true }).decode(cp.assetTerms.name);
    } catch {
      // Non-UTF-8 name: carry asset opaquely without a display name (spec §1.5).
      assetTermsName = undefined;
    }
  }

  // On fatalError omit coin / creatingNullifier / navOpening / state (Path-B
  // failures must not surface coin fields). anchoring and assetTermsName may remain.
  const view: ConfirmationView = {
    checks,
    anchoring,
  };
  if (fatalError === undefined) {
    view.coin = coin;
    view.creatingNullifier = creatingNullifier;
    view.navOpening = navOpening;
    if (state !== undefined) {
      view.state = state;
    }
  } else {
    view.fatalError = fatalError;
  }
  if (assetTermsName !== undefined) {
    view.assetTermsName = assetTermsName;
  }
  return view;
}
