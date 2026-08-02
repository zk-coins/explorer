/**
 * Normative §7.5 wire shapes used by Public mode.
 *
 * Field names match the specification exactly. Unknown producer fields are
 * ignored on read; missing required fields are hard errors (fail-closed).
 */

/** §3.10 per-nullifier state — supplied by the node from its own scan; never guessed client-side. */
export type NullifierState = 'pending' | 'completed' | 'failed';

/** Reveal-tx confirmation depth relative to the §3.9 6-confirmation floor — never `failed`. */
export type ConfirmationState = 'pending' | 'completed';

export type NetworkTag = 'mainnet' | 'testnet' | 'regtest';

/** `GET /v1/info` — fields Public mode and blob-size gates use. */
export interface InfoResponse {
  network: NetworkTag;
  protocol_version: string;
  finality_confirmations: number;
  activation_height: number;
  /**
   * §7.4 / §7.5 advertised Blossom body size ceiling (bytes). Required for
   * fail-closed blob loads — never invent a default when the field is absent.
   */
  max_blob_bytes: number;
  features: string[];
}

/**
 * `GET /v1/chain/accumulator`
 * `root` is always `nav_root = Hc("NfLog/Root", size ‖ mth)` — never bare `mth` (§7.5).
 */
export interface AccumulatorResponse {
  size: number;
  root: string;
  tip_block_hash: string;
  tip_height: number;
}

/** One member of a half-aggregated `(Pkⱼ, Rⱼ)` set. */
export interface InscriptionNullifier {
  pubkey: string;
  r: string;
  state: NullifierState;
}

/** One AggregateStateNullifierV3 inscription entry from `/v1/chain/inscriptions`. */
export interface InscriptionEntry {
  txid: string;
  height: number;
  tx_index: number;
  vin_index: number;
  count: number;
  format: number;
  nullifiers: InscriptionNullifier[];
  confirmation_state: ConfirmationState;
}

/** `GET /v1/chain/inscriptions` response. */
export interface InscriptionsResponse {
  inscriptions: InscriptionEntry[];
  next_height?: number;
  next_tx_index?: number;
  next_vin_index?: number;
}

/**
 * `GET /v1/chain/nullifier/<pubkey>`
 * When `present: false`, absence is an unauthenticated local-index answer —
 * not an RFC-6962 non-inclusion proof (§3.7 / §7.5).
 */
export interface NullifierLookupResponse {
  present: boolean;
  position?: number;
  leaf?: string;
  audit_path: string[];
  tree_size: number;
  root: string;
  tip_block_hash: string;
  tip_height: number;
}

/** Generic §7.5 error body. */
export interface ApiErrorBody {
  error: string;
  message: string;
}

export class NodeApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'NodeApiError';
    this.status = status;
    this.code = code;
  }
}
