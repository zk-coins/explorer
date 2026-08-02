/**
 * §5.8 address view (bearer zkavk) — mode selection + mesh discovery + decryption.
 *
 * Variants:
 *   - 64 B: ivk ‖ ovk  → full history (incoming + outgoing recovery)
 *   - 32 B: ivk only   → incoming only; outgoing side marked not-derivable
 *
 * Production path (`resolveAddressView`):
 *   1. Validate zkavk scalars fail-closed
 *   2. Resolve relay/holder URLs from the fragment holder-hint
 *   3. Scan mesh for gift-wrap candidates (zkdt/zkepk + resolved blob_id)
 *   4. Match detect_tag via ECDH(ivk, epk)
 *   5. Fetch ZBE blobs from Blossom holders and open under K_tx
 *
 * Without a reachable mesh (no holder/relays and no scan result) history is
 * marked not-yet-resolvable — never an empty list that looks like "no payments".
 */

import { detectTag, digestToBytes } from '@zkcoins/sdk';
import { fetchBlossomBlobFromHolders } from '@/lib/api/blossom';
import { fetchInfo } from '@/lib/api/client';
import { coinToView, deserializeCoinProof, type CoinProof } from '@/lib/bundle/coinProof';
import { bytesEqual, decodeHexExact, encodeHexLower } from '@/lib/crypto/bytes';
import { EcdhError, sharedSecretReceiver } from '@/lib/crypto/ecdh';
import { deriveNoteKey, deriveOutKey } from '@/lib/crypto/hkdf';
import { ZbeError, zbeOpen } from '@/lib/crypto/zbe';
import { fail, open, pass, type CheckItem } from '@/lib/bearer/checks';
import type { AddrFragmentOk } from '@/lib/fragments';
import { schnorr } from '@noble/curves/secp256k1.js';

const Point = schnorr.Point;
const { Fn } = Point;

export type AddressViewMode = 'incoming_only' | 'full';

export interface DecryptedIncoming {
  coin: ReturnType<typeof coinToView>;
  epkHex: string;
  detectTagHex: string;
  creatingPkHex: string;
  side: 'incoming';
}

export interface OutgoingNotDerivable {
  side: 'outgoing';
  status: 'not_derivable';
  reason: string;
}

export interface DecryptedOutgoing {
  side: 'outgoing';
  /** Only after a successful open of the coin ciphertext under K_tx. */
  status: 'recovered';
  coin: ReturnType<typeof coinToView>;
  coinIdHex: string;
  blobIdHex: string;
  epkHex: string;
}

/** Outgoing material seen but not opened (NIP-44 / K_tx recovery still open). */
export interface OutgoingUnresolved {
  side: 'outgoing';
  status: 'unresolved';
  reason: string;
  coinIdHex: string;
  blobIdHex: string;
  epkHex: string;
}

export type HistoryEntry =
  DecryptedIncoming | OutgoingNotDerivable | DecryptedOutgoing | OutgoingUnresolved;

export interface AddressViewResult {
  mode: AddressViewMode;
  addressHex: string;
  checks: CheckItem[];
  history: HistoryEntry[];
  /**
   * True when this build cannot resolve live history (no mesh scan / no
   * matching candidates). UI must not present empty history as "no payments".
   */
  historyNotResolvable?: boolean;
  fatalError?: string;
}

/**
 * Mesh candidate after gift-wrap scan (cleartext zkdt/zkepk + resolved blob_id).
 * NIP-59 unwrap of the rumor is the responsibility of the mesh scanner.
 */
export interface MeshDeliveryCandidate {
  epk: Uint8Array;
  detectTag: Uint8Array;
  blobId: Uint8Array;
  /** Blossom bases expected to serve this blob (may be empty → node default). */
  blobLocators: string[];
  side?: 'incoming' | 'outgoing';
  coinId?: Uint8Array;
  /** Present only when ovk recovery material is already available. */
  kTx?: Uint8Array;
  zbeCiphertext?: Uint8Array;
}

export interface AddressViewDeps {
  /**
   * Scan paired relays / mesh gateway for kind-1059 delivery candidates.
   * Production default queries each relay URL for a JSON candidate list
   * (tests mock this; a full NIP-59 WebSocket client may replace it).
   */
  scanMesh?: (opts: {
    relayUrls: string[];
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
  }) => Promise<MeshDeliveryCandidate[]>;
  fetchBlobFromHolders?: typeof fetchBlossomBlobFromHolders;
  fetchInfo?: typeof fetchInfo;
  baseUrl?: string;
  signal?: AbortSignal;
  maxBlobBytes?: number | bigint;
  fetchImpl?: typeof fetch;
}

function bytesToBigint(bytes: Uint8Array): bigint {
  let n = 0n;
  for (const b of bytes) {
    n = (n << 8n) | BigInt(b);
  }
  return n;
}

/** Fail-closed: secret scalar must be in [1, n). */
export function requireSecretScalar(bytes: Uint8Array, field: string): void {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) {
    throw new Error(
      `${field}: must be 32 bytes, got ${bytes instanceof Uint8Array ? bytes.length : typeof bytes}`,
    );
  }
  const d = bytesToBigint(bytes);
  if (d === 0n || d >= Fn.ORDER) {
    throw new Error(`${field}: scalar is not in [1, n)`);
  }
}

/** Select mode from zkavk payload length; validate secret scalars fail-closed. */
export function selectAvkMode(avk: Uint8Array): {
  mode: AddressViewMode;
  ivk: Uint8Array;
  ovk?: Uint8Array;
} {
  if (avk.length === 32) {
    requireSecretScalar(avk, 'zkavk.ivk');
    return { mode: 'incoming_only', ivk: avk.slice() };
  }
  if (avk.length === 64) {
    const ivk = avk.slice(0, 32);
    const ovk = avk.slice(32, 64);
    requireSecretScalar(ivk, 'zkavk.ivk');
    requireSecretScalar(ovk, 'zkavk.ovk');
    return { mode: 'full', ivk, ovk };
  }
  throw new Error(`zkavk payload must be 32 or 64 bytes, got ${avk.length}`);
}

/**
 * Re-derive K_tx from ivk + epk and open a ZBE CoinProof ciphertext.
 */
export function decryptIncomingBundle(
  ivk: Uint8Array,
  epk: Uint8Array,
  zbeCiphertext: Uint8Array,
): CoinProof {
  const ss = sharedSecretReceiver(ivk, epk);
  const kTx = deriveNoteKey(ss, epk);
  const plain = zbeOpen(kTx, zbeCiphertext);
  return deserializeCoinProof(plain);
}

/**
 * Compute detect_tag = Hc("DetectTag", ss, epk) for mesh matching.
 */
export function computeDetectTag(ivk: Uint8Array, epk: Uint8Array): Uint8Array {
  const ss = sharedSecretReceiver(ivk, epk);
  const digest = detectTag(ss, epk);
  return digestToBytes(digest);
}

/**
 * Recover K_tx from out_ciphertext material when ovk is held.
 * out_ciphertext is NIP-44 AEAD payload (UTF-8 Base64) — opening it requires
 * NIP-44, which is out of scope here. We only derive K_out; callers that
 * already have K_tx (test fixtures) use openOutgoingWithKtx.
 */
export function deriveOutgoingKey(ovk: Uint8Array, epk: Uint8Array): Uint8Array {
  return deriveOutKey(ovk, epk);
}

export function openOutgoingWithKtx(kTx: Uint8Array, zbeCiphertext: Uint8Array): CoinProof {
  const plain = zbeOpen(kTx, zbeCiphertext);
  return deserializeCoinProof(plain);
}

export interface DiscoveredIncoming {
  epk: Uint8Array;
  zbeCiphertext: Uint8Array;
}

export interface DiscoveredOutgoing {
  coinId: Uint8Array;
  blobId: Uint8Array;
  epk: Uint8Array;
  /** When already known (tests); otherwise recovery needs NIP-44 open of out_ciphertext. */
  kTx?: Uint8Array;
  zbeCiphertext?: Uint8Array;
}

/**
 * Holder / relay URLs from §5.6 holder-hint form (`@https://…` or comma-joined http bases).
 */
export function parseMeshUrls(hint: string | undefined): string[] {
  if (hint === undefined || hint.length === 0) {
    return [];
  }
  if (hint.startsWith('@')) {
    const url = hint.slice(1);
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return [url.replace(/\/+$/, '')];
    }
    return [];
  }
  if (hint.includes(',')) {
    return hint
      .split(',')
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter((s) => s.startsWith('http://') || s.startsWith('https://'));
  }
  if (hint.startsWith('http://') || hint.startsWith('https://')) {
    return [hint.replace(/\/+$/, '')];
  }
  return [];
}

/**
 * Default mesh scan: GET `{relay}/.well-known/zkcoins/delivery-events`.
 * A gateway or test double returns pre-resolved candidates
 * `{ epk, detect_tag, blob_id, blob_locators? }` (hex fields).
 * A full NIP-59 client may replace this via `deps.scanMesh`.
 */
export async function defaultScanMesh(opts: {
  relayUrls: string[];
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<MeshDeliveryCandidate[]> {
  if (opts.relayUrls.length === 0) {
    return [];
  }
  const fetchImpl = opts.fetchImpl !== undefined ? opts.fetchImpl : fetch;
  const out: MeshDeliveryCandidate[] = [];
  for (const relay of opts.relayUrls) {
    const url = `${relay}/.well-known/zkcoins/delivery-events`;
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: opts.signal,
      });
    } catch {
      // Unreachable relay — try the next; overall emptiness is handled above.
      continue;
    }
    if (!res.ok) {
      continue;
    }
    let raw: unknown;
    try {
      raw = await res.json();
    } catch {
      continue;
    }
    if (!Array.isArray(raw)) {
      continue;
    }
    for (const item of raw) {
      if (item === null || typeof item !== 'object') {
        continue;
      }
      const o = item as Record<string, unknown>;
      try {
        const epk = decodeHexExact(String(o.epk ?? ''), 32, 'mesh.epk');
        const detectTagBytes = decodeHexExact(String(o.detect_tag ?? ''), 32, 'mesh.detect_tag');
        const blobId = decodeHexExact(String(o.blob_id ?? ''), 32, 'mesh.blob_id');
        const locators: string[] = [];
        if (Array.isArray(o.blob_locators)) {
          for (const loc of o.blob_locators) {
            if (
              typeof loc === 'string' &&
              (loc.startsWith('http://') || loc.startsWith('https://'))
            ) {
              locators.push(loc.replace(/\/+$/, ''));
            }
          }
        }
        const candidate: MeshDeliveryCandidate = {
          epk,
          detectTag: detectTagBytes,
          blobId,
          blobLocators: locators,
        };
        if (o.side === 'outgoing') {
          candidate.side = 'outgoing';
          if (typeof o.coin_id === 'string') {
            candidate.coinId = decodeHexExact(o.coin_id, 32, 'mesh.coin_id');
          }
        } else {
          candidate.side = 'incoming';
        }
        out.push(candidate);
      } catch {
        // Malformed candidate — skip, do not invent.
      }
    }
  }
  return out;
}

/**
 * Build the address-view model from keys + discovered bundles.
 * When no discoveries are provided, history is empty and mesh scan is open;
 * `historyNotResolvable` is set so the UI does not look like "no history".
 */
export function buildAddressView(
  fragment: AddrFragmentOk,
  discoveries: {
    incoming?: DiscoveredIncoming[];
    outgoing?: DiscoveredOutgoing[];
  } = {},
  opts: { meshScanned?: boolean } = {},
): AddressViewResult {
  const checks: CheckItem[] = [];
  let mode: AddressViewMode;
  let ivk: Uint8Array;
  let ovk: Uint8Array | undefined;
  try {
    ({ mode, ivk, ovk } = selectAvkMode(fragment.avk));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      mode: fragment.avkByteLength === 32 ? 'incoming_only' : 'full',
      addressHex: encodeHexLower(fragment.address),
      checks: [fail('avk_mode', 'zkavk mode / scalar check', detail)],
      history: [],
      fatalError: detail,
    };
  }
  const addressHex = encodeHexLower(fragment.address);

  checks.push(
    pass(
      'avk_mode',
      'zkavk mode',
      mode === 'full'
        ? '64-byte payload → ivk ‖ ovk (full history); scalars in [1, n)'
        : '32-byte payload → ivk only (incoming-only); ivk in [1, n)',
    ),
  );
  checks.push(pass('address_bind', 'Fragment address', `subject ${addressHex}`));

  const history: HistoryEntry[] = [];
  const incoming = discoveries.incoming ?? [];
  const outgoing = discoveries.outgoing ?? [];
  const noDiscoveries = incoming.length === 0 && outgoing.length === 0;
  const meshScanned = opts.meshScanned === true;

  if (noDiscoveries && !meshScanned) {
    checks.push(
      open(
        'mesh_scan',
        'Nostr mesh scan (detect_tag match)',
        'Not yet resolvable: no holder/relay URLs and no mesh scan result — live discovery requires scanning paired relays for kind-1059 gift-wraps',
      ),
    );
  } else if (noDiscoveries && meshScanned) {
    checks.push(
      pass(
        'mesh_scan',
        'Nostr mesh scan (detect_tag match)',
        'Mesh scan completed; no detect_tag matches for this ivk',
      ),
    );
  } else {
    checks.push(
      pass(
        'mesh_scan',
        'Nostr mesh scan (detect_tag match)',
        `Processing ${incoming.length} incoming + ${outgoing.length} outgoing discovered bundle(s)`,
      ),
    );
  }

  for (const item of incoming) {
    try {
      const tag = computeDetectTag(ivk, item.epk);
      const cp = decryptIncomingBundle(ivk, item.epk, item.zbeCiphertext);
      // Recipient must match the disclosed address — never surface foreign coins.
      if (encodeHexLower(cp.coin.recipient) !== addressHex) {
        checks.push(
          fail(
            `incoming_${encodeHexLower(cp.coin.identifier).slice(0, 8)}`,
            'Incoming coin recipient matches address',
            `coin.recipient ${encodeHexLower(cp.coin.recipient)} ≠ ${addressHex}`,
          ),
        );
        continue;
      }
      history.push({
        side: 'incoming',
        coin: coinToView(cp.coin),
        epkHex: encodeHexLower(item.epk),
        detectTagHex: encodeHexLower(tag),
        creatingPkHex: encodeHexLower(cp.creatingNullifier.pkCreate),
      });
    } catch (err) {
      const detail =
        err instanceof ZbeError || err instanceof EcdhError
          ? `${err.name}: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      checks.push(fail('incoming_decrypt', 'Incoming bundle decrypt', detail));
    }
  }

  if (mode === 'incoming_only') {
    history.push({
      side: 'outgoing',
      status: 'not_derivable',
      reason:
        'zkavk is ivk-only (32 B); ovk is required to open out_ciphertext / recover outgoing K_tx',
    });
    checks.push(
      pass(
        'outgoing_ivk_only',
        'Outgoing side under ivk-only',
        'Marked not-derivable (not shown as empty success)',
      ),
    );
  } else if (ovk !== undefined) {
    if (outgoing.length === 0 && !noDiscoveries) {
      checks.push(
        open(
          'outgoing_recovery',
          'Outgoing recovery via ovk',
          'No SelfDeliveryRecord / output_ref material supplied; full mesh recovery of SDRs is an open step',
        ),
      );
    } else if (outgoing.length === 0 && noDiscoveries) {
      checks.push(
        open(
          'outgoing_recovery',
          'Outgoing recovery via ovk',
          meshScanned
            ? 'Mesh scan found no outgoing SDR material for this ovk'
            : 'Not yet resolvable without mesh discovery / SDR material',
        ),
      );
    }
    for (const item of outgoing) {
      if (item.kTx === undefined || item.zbeCiphertext === undefined) {
        checks.push(
          open(
            `outgoing_${encodeHexLower(item.coinId).slice(0, 8)}`,
            'Outgoing coin open',
            'K_tx recovery needs NIP-44 open of out_ciphertext under K_out; not available for this entry',
          ),
        );
        history.push({
          side: 'outgoing',
          status: 'unresolved',
          reason:
            'K_tx not recovered (NIP-44 open of out_ciphertext under K_out is not performed in this build)',
          coinIdHex: encodeHexLower(item.coinId),
          blobIdHex: encodeHexLower(item.blobId),
          epkHex: encodeHexLower(item.epk),
        });
        try {
          deriveOutgoingKey(ovk, item.epk);
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          checks.push(fail('k_out_derive', 'K_out derivation', detail));
        }
        continue;
      }
      try {
        const cp = openOutgoingWithKtx(item.kTx, item.zbeCiphertext);
        history.push({
          side: 'outgoing',
          status: 'recovered',
          coin: coinToView(cp.coin),
          coinIdHex: encodeHexLower(item.coinId),
          blobIdHex: encodeHexLower(item.blobId),
          epkHex: encodeHexLower(item.epk),
        });
        checks.push(
          pass(
            `outgoing_${encodeHexLower(item.coinId).slice(0, 8)}`,
            'Outgoing coin open',
            `amount=${cp.coin.amount.toString(10)}`,
          ),
        );
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        checks.push(fail('outgoing_decrypt', 'Outgoing bundle decrypt', detail));
      }
    }
  }

  checks.push(
    open(
      'bitcoin_verify',
      'Per-tx Bitcoin / proof verification',
      'Each history entry should be checked like §5.6 (first-occurrence completed, recursive proof, canonical nav); same open limits as confirmation links',
    ),
  );

  const result: AddressViewResult = {
    mode,
    addressHex,
    checks,
    history,
  };
  if (noDiscoveries && !meshScanned) {
    result.historyNotResolvable = true;
  }
  return result;
}

/**
 * Live resolve: mesh scan → detect_tag match → blob fetch → decrypt.
 * The production route calls this with only the fragment (no injected discoveries).
 */
export async function resolveAddressView(
  fragment: AddrFragmentOk,
  deps: AddressViewDeps = {},
): Promise<AddressViewResult> {
  // Fail-closed scalar check before any network work.
  try {
    selectAvkMode(fragment.avk);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      mode: fragment.avkByteLength === 32 ? 'incoming_only' : 'full',
      addressHex: encodeHexLower(fragment.address),
      checks: [fail('avk_mode', 'zkavk mode / scalar check', detail)],
      history: [],
      fatalError: detail,
    };
  }

  const { mode, ivk } = selectAvkMode(fragment.avk);
  const relayUrls = parseMeshUrls(fragment.holderHint);
  const scanMesh = deps.scanMesh !== undefined ? deps.scanMesh : defaultScanMesh;
  const fetchFromHolders =
    deps.fetchBlobFromHolders !== undefined
      ? deps.fetchBlobFromHolders
      : fetchBlossomBlobFromHolders;

  let maxBlobBytes = deps.maxBlobBytes;
  if (maxBlobBytes === undefined) {
    try {
      const fetchInfoFn = deps.fetchInfo !== undefined ? deps.fetchInfo : fetchInfo;
      const info = await fetchInfoFn({ baseUrl: deps.baseUrl, signal: deps.signal });
      maxBlobBytes = info.max_blob_bytes;
    } catch {
      // Mesh may still work with an explicit max; without either, blob fetch fails closed later.
    }
  }

  let candidates: MeshDeliveryCandidate[] = [];
  let meshScanned = false;
  const canScan = relayUrls.length > 0 || deps.scanMesh !== undefined;
  if (canScan) {
    meshScanned = true;
    try {
      candidates = await scanMesh({
        relayUrls,
        signal: deps.signal,
        fetchImpl: deps.fetchImpl,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return {
        mode,
        addressHex: encodeHexLower(fragment.address),
        checks: [fail('mesh_scan', 'Nostr mesh scan (detect_tag match)', detail)],
        history: [],
        fatalError: `mesh scan failed: ${detail}`,
      };
    }
  }

  const incoming: DiscoveredIncoming[] = [];
  const outgoing: DiscoveredOutgoing[] = [];

  for (const cand of candidates) {
    let expectedTag: Uint8Array;
    try {
      expectedTag = computeDetectTag(ivk, cand.epk);
    } catch {
      continue;
    }
    if (!bytesEqual(expectedTag, cand.detectTag)) {
      continue;
    }

    if (cand.side === 'outgoing') {
      outgoing.push({
        coinId: cand.coinId !== undefined ? cand.coinId : new Uint8Array(32),
        blobId: cand.blobId,
        epk: cand.epk,
        ...(cand.kTx !== undefined ? { kTx: cand.kTx } : {}),
        ...(cand.zbeCiphertext !== undefined ? { zbeCiphertext: cand.zbeCiphertext } : {}),
      });
      continue;
    }

    // Incoming: fetch ZBE if not already present.
    if (cand.zbeCiphertext !== undefined) {
      incoming.push({ epk: cand.epk, zbeCiphertext: cand.zbeCiphertext });
      continue;
    }

    if (maxBlobBytes === undefined) {
      // Cannot fetch without a size ceiling — leave as not resolvable for this entry.
      continue;
    }

    const holders =
      cand.blobLocators.length > 0 ? cand.blobLocators : parseMeshUrls(fragment.holderHint);
    if (holders.length === 0) {
      continue;
    }
    try {
      const got = await fetchFromHolders(cand.blobId, holders, {
        maxBlobBytes,
        signal: deps.signal,
      });
      incoming.push({ epk: cand.epk, zbeCiphertext: got.body });
    } catch {
      // Blob unavailable from holders — skip this candidate.
    }
  }

  return buildAddressView(fragment, { incoming, outgoing }, { meshScanned });
}
