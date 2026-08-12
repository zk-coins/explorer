/**
 * Map §7.5 Public responses into view models for Public mode (§5.5).
 *
 * These models intentionally omit every §5.5-forbidden field: amounts,
 * asset_id / asset names, balances, addresses, senders, recipients, and
 * anything sourced from a CoinProof bundle. There is no UTXO/output graph.
 *
 * Wire `u64` values are carried as `bigint` (canonical decimal-string parse).
 */

import type {
  AccumulatorResponse,
  InfoResponse,
  InscriptionEntry,
  InscriptionsResponse,
  NullifierLookupResponse,
  NullifierState,
  ConfirmationState,
} from './types';

/** One half-aggregated nullifier member as Public mode presents it. */
export interface PublicNullifierMember {
  /** Pkⱼ (x-only hex) — rotating, unlinkable to any account in Public mode. */
  pubkey: string;
  /** Rⱼ sign-to-contract nonce (x-only hex). */
  r: string;
  /** §3.10 state from the node — never client-guessed. */
  state: NullifierState;
}

/**
 * One AggregateStateNullifierV3 inscription in Public mode.
 *
 * Publisher identity on chain is the reveal transaction itself (§3.5
 * metadata note): the reveal `txid` is what Public mode shows as the
 * publisher-facing anchor. No account or payment is linked to any Pkⱼ.
 */
export interface PublicInscription {
  txid: string;
  height: bigint;
  tx_index: number;
  vin_index: number;
  /** Number of half-aggregated members (per-block transition count unit). */
  count: number;
  format: number;
  nullifiers: PublicNullifierMember[];
  confirmation_state: ConfirmationState;
}

/** Aggregate counts required by §5.5. */
export interface PublicAggregateCounts {
  /** Number of inscriptions in the presented page/set. */
  inscription_count: number;
  /**
   * Per-block transition counts: sum of `count` (nullifier members) per
   * Bitcoin block height in the presented set.
   */
  transitions_per_block: Array<{ height: bigint; transitions: number }>;
  /** Global accumulator size (first-occurrence fold length). */
  accumulator_size: bigint;
}

/** Accumulator view: (size, nav_root) with tip anchoring. */
export interface PublicAccumulatorView {
  size: bigint;
  /** nav_root = Hc("NfLog/Root", size ‖ mth) — API field `root` (§7.5). */
  nav_root: string;
  tip_block_hash: string;
  tip_height: bigint;
}

/** Network context shown alongside Public data. */
export interface PublicNetworkInfo {
  network: InfoResponse['network'];
  protocol_version: string;
  finality_confirmations: number;
  activation_height: bigint;
}

/**
 * Nullifier membership answer for Path-B display (§3.7 / §5.5).
 *
 * Public mode presents the node's answer with the explicit caveat that a
 * client must check it against its own scan — the explorer asserts no
 * authority it does not have.
 */
export interface PublicNullifierLookup {
  present: boolean;
  position?: bigint;
  leaf?: string;
  audit_path: string[];
  tree_size: bigint;
  nav_root: string;
  tip_block_hash: string;
  tip_height: bigint;
  /** Always true in the view model — UI must surface the Path-B caveat. */
  client_must_verify_against_own_scan: true;
}

export function mapInscription(entry: InscriptionEntry): PublicInscription {
  return {
    txid: entry.txid,
    height: entry.height,
    tx_index: entry.tx_index,
    vin_index: entry.vin_index,
    count: entry.count,
    format: entry.format,
    nullifiers: entry.nullifiers.map((n) => ({
      pubkey: n.pubkey,
      r: n.r,
      state: n.state,
    })),
    confirmation_state: entry.confirmation_state,
  };
}

export function mapInscriptions(response: InscriptionsResponse): PublicInscription[] {
  return response.inscriptions.map(mapInscription);
}

export function mapAccumulator(response: AccumulatorResponse): PublicAccumulatorView {
  return {
    size: response.size,
    nav_root: response.root,
    tip_block_hash: response.tip_block_hash,
    tip_height: response.tip_height,
  };
}

export function mapInfo(response: InfoResponse): PublicNetworkInfo {
  return {
    network: response.network,
    protocol_version: response.protocol_version,
    finality_confirmations: response.finality_confirmations,
    activation_height: response.activation_height,
  };
}

export function mapNullifierLookup(response: NullifierLookupResponse): PublicNullifierLookup {
  const view: PublicNullifierLookup = {
    present: response.present,
    audit_path: response.audit_path.slice(),
    tree_size: response.tree_size,
    nav_root: response.root,
    tip_block_hash: response.tip_block_hash,
    tip_height: response.tip_height,
    client_must_verify_against_own_scan: true,
  };
  if (response.present) {
    if (response.position === undefined) {
      throw new Error('mapNullifierLookup: present true but position missing');
    }
    if (response.leaf === undefined) {
      throw new Error('mapNullifierLookup: present true but leaf missing');
    }
    view.position = response.position;
    view.leaf = response.leaf;
  }
  return view;
}

/**
 * §5.5 aggregate counts from a presented inscription set + accumulator size.
 */
export function computeAggregateCounts(
  inscriptions: PublicInscription[],
  accumulatorSize: bigint,
): PublicAggregateCounts {
  const byHeight = new Map<bigint, number>();
  for (const ins of inscriptions) {
    const prev = byHeight.get(ins.height);
    const add = ins.count;
    if (prev === undefined) {
      byHeight.set(ins.height, add);
    } else {
      byHeight.set(ins.height, prev + add);
    }
  }
  const transitions_per_block = Array.from(byHeight.entries())
    .map(([height, transitions]) => ({ height, transitions }))
    .sort((a, b) => {
      if (a.height < b.height) {
        return -1;
      }
      /* v8 ignore else -- byHeight is a Map keyed by height, so distinct entries passed to the comparator have unique height values and cannot reach equality */
      if (a.height > b.height) {
        return 1;
      } else {
        return 0;
      }
    });

  return {
    inscription_count: inscriptions.length,
    transitions_per_block,
    accumulator_size: accumulatorSize,
  };
}

/**
 * Flatten a Public-mode view into a single text blob for forbidden-field
 * regression tests. Only Public-allowed fields are serialised.
 */
export function publicViewToSearchableText(input: {
  inscriptions: PublicInscription[];
  accumulator: PublicAccumulatorView;
  counts: PublicAggregateCounts;
  info: PublicNetworkInfo;
  nullifierLookup?: PublicNullifierLookup;
}): string {
  const parts: string[] = [];
  parts.push(`network=${input.info.network}`);
  parts.push(`protocol_version=${input.info.protocol_version}`);
  parts.push(`finality_confirmations=${input.info.finality_confirmations}`);
  parts.push(`activation_height=${input.info.activation_height.toString(10)}`);
  parts.push(`nav_root=${input.accumulator.nav_root}`);
  parts.push(`accumulator_size=${input.accumulator.size.toString(10)}`);
  parts.push(`tip_block_hash=${input.accumulator.tip_block_hash}`);
  parts.push(`tip_height=${input.accumulator.tip_height.toString(10)}`);
  parts.push(`inscription_count=${input.counts.inscription_count}`);
  for (const row of input.counts.transitions_per_block) {
    parts.push(`block=${row.height.toString(10)}:transitions=${row.transitions}`);
  }
  for (const ins of input.inscriptions) {
    parts.push(`txid=${ins.txid}`);
    parts.push(`height=${ins.height.toString(10)}`);
    parts.push(`tx_index=${ins.tx_index}`);
    parts.push(`vin_index=${ins.vin_index}`);
    parts.push(`count=${ins.count}`);
    parts.push(`format=${ins.format}`);
    parts.push(`confirmation_state=${ins.confirmation_state}`);
    for (const n of ins.nullifiers) {
      parts.push(`pubkey=${n.pubkey}`);
      parts.push(`r=${n.r}`);
      parts.push(`state=${n.state}`);
    }
  }
  if (input.nullifierLookup !== undefined) {
    const nl = input.nullifierLookup;
    parts.push(`lookup_present=${nl.present}`);
    parts.push(`lookup_tree_size=${nl.tree_size.toString(10)}`);
    parts.push(`lookup_nav_root=${nl.nav_root}`);
    parts.push(`lookup_tip_block_hash=${nl.tip_block_hash}`);
    parts.push(`lookup_tip_height=${nl.tip_height.toString(10)}`);
    if (nl.position !== undefined) {
      parts.push(`lookup_position=${nl.position.toString(10)}`);
    }
    if (nl.leaf !== undefined) {
      parts.push(`lookup_leaf=${nl.leaf}`);
    }
    for (const h of nl.audit_path) {
      parts.push(`audit=${h}`);
    }
    parts.push('client_must_verify_against_own_scan=true');
  }
  return parts.join('\n');
}

/**
 * §5.5 forbidden tokens that Public mode MUST NOT surface.
 * Used by the regression test that scans rendered/searchable output.
 */
export const PUBLIC_MODE_FORBIDDEN_FIELD_NAMES = [
  'amount',
  'amounts',
  'asset_id',
  'asset_ids',
  'asset_name',
  'asset_names',
  'balance',
  'balances',
  'address',
  'addresses',
  'sender',
  'senders',
  'recipient',
  'recipients',
  'coinproof',
  'coin_proof',
  'CoinProof',
  'output_graph',
  'utxo',
  'UTXO',
  'prev_root',
  'new_root',
  'BatchInscription',
] as const;
