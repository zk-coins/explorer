/**
 * §5.8 address view (bearer zkavk) — mode selection + decryption helpers.
 *
 * Variants:
 *   - 64 B: ivk ‖ ovk  → full history (incoming + outgoing recovery)
 *   - 32 B: ivk only   → incoming only; outgoing side marked not-derivable
 *
 * Discovery of gift-wrapped delivery events is a mesh/Nostr scan. This build
 * does not auto-scan relays: without injected discoveries the route reports
 * history as not yet resolvable (never an empty list that looks like
 * "no history"). Outgoing entries without K_tx are `unresolved`, not
 * `recovered`.
 */

import { detectTag, digestToBytes } from '@zkcoins/sdk';
import { coinToView, deserializeCoinProof, type CoinProof } from '@/lib/bundle/coinProof';
import { encodeHexLower } from '@/lib/crypto/bytes';
import { sharedSecretReceiver } from '@/lib/crypto/ecdh';
import { deriveNoteKey, deriveOutKey } from '@/lib/crypto/hkdf';
import { ZbeError, zbeOpen } from '@/lib/crypto/zbe';
import { fail, open, pass, type CheckItem } from '@/lib/bearer/checks';
import type { AddrFragmentOk } from '@/lib/fragments';

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
   * injected discoveries). UI must not present empty history as "no payments".
   */
  historyNotResolvable?: boolean;
  fatalError?: string;
}

/** Select mode from zkavk payload length. */
export function selectAvkMode(avk: Uint8Array): {
  mode: AddressViewMode;
  ivk: Uint8Array;
  ovk?: Uint8Array;
} {
  if (avk.length === 32) {
    return { mode: 'incoming_only', ivk: avk.slice() };
  }
  if (avk.length === 64) {
    return {
      mode: 'full',
      ivk: avk.slice(0, 32),
      ovk: avk.slice(32, 64),
    };
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
 * Build the address-view model from keys + optional discovered bundles.
 * When no discoveries are provided, history is empty and mesh scan is open;
 * `historyNotResolvable` is set so the UI does not look like "no history".
 */
export function buildAddressView(
  fragment: AddrFragmentOk,
  discoveries: {
    incoming?: DiscoveredIncoming[];
    outgoing?: DiscoveredOutgoing[];
  } = {},
): AddressViewResult {
  const checks: CheckItem[] = [];
  const { mode, ivk, ovk } = selectAvkMode(fragment.avk);
  const addressHex = encodeHexLower(fragment.address);

  checks.push(
    pass(
      'avk_mode',
      'zkavk mode',
      mode === 'full'
        ? '64-byte payload → ivk ‖ ovk (full history)'
        : '32-byte payload → ivk only (incoming-only)',
    ),
  );
  checks.push(pass('address_bind', 'Fragment address', `subject ${addressHex}`));

  const history: HistoryEntry[] = [];
  const incoming = discoveries.incoming ?? [];
  const outgoing = discoveries.outgoing ?? [];
  const noDiscoveries = incoming.length === 0 && outgoing.length === 0;

  if (noDiscoveries) {
    checks.push(
      open(
        'mesh_scan',
        'Nostr mesh scan (detect_tag match)',
        'Not yet resolvable in this build: live discovery requires scanning paired relays for kind-1059 gift-wraps and matching detect_tag from ivk+epk — no relay client is wired here',
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
      // Recipient should match the disclosed address.
      if (encodeHexLower(cp.coin.recipient) !== addressHex) {
        checks.push(
          fail(
            `incoming_${encodeHexLower(cp.coin.identifier).slice(0, 8)}`,
            'Incoming coin recipient matches address',
            `coin.recipient ${encodeHexLower(cp.coin.recipient)} ≠ ${addressHex}`,
          ),
        );
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
        err instanceof ZbeError
          ? `${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      checks.push(fail('incoming_decrypt', 'Incoming bundle decrypt', detail));
    }
  }

  if (mode === 'incoming_only') {
    // Spec: under ivk-only, outgoing recovery is skipped and the outgoing side
    // is rendered as not-derivable — never as an empty list that looks like
    // "no outgoings".
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
          'Not yet resolvable in this build without mesh discovery / SDR material',
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
        // Still prove K_out derivation works (no silent skip).
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
  if (noDiscoveries) {
    result.historyNotResolvable = true;
  }
  return result;
}

/**
 * Live resolve. This build has no mesh/relay client: without explicit
 * discoveries, history is marked not-resolvable (not an empty success).
 * Tests inject discoveries via the second argument.
 */
export async function resolveAddressView(
  fragment: AddrFragmentOk,
  discoveries: {
    incoming?: DiscoveredIncoming[];
    outgoing?: DiscoveredOutgoing[];
  } = {},
): Promise<AddressViewResult> {
  return buildAddressView(fragment, discoveries);
}
