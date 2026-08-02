/**
 * Normative §7.5 shapes for Public-mode tests (not production mocks).
 *
 * Wire `u64` fields use the canonical §7.1 decimal-string form
 * (`0|[1-9][0-9]*`). Parsed values are `bigint` on the typed response side;
 * fixtures that feed the *parser* keep the string form the node actually
 * emits. Typed response fixtures (post-parse) use bigint.
 */

import type {
  AccumulatorResponse,
  InfoResponse,
  InscriptionsResponse,
  NullifierLookupResponse,
} from '@/lib/api/types';

/** Raw JSON body as a conforming REST producer emits it (u64 as decimal strings). */
export const FIXTURE_INFO_RAW = {
  network: 'regtest',
  protocol_version: 'v1',
  finality_confirmations: 6,
  activation_height: '0',
  max_blob_bytes: '1048576',
  features: ['explorer'],
} as const;

/** Post-parse typed fixture. */
export const FIXTURE_INFO: InfoResponse = {
  network: 'regtest',
  protocol_version: 'v1',
  finality_confirmations: 6,
  activation_height: 0n,
  max_blob_bytes: 1_048_576n,
  features: ['explorer'],
};

export const FIXTURE_ACCUMULATOR_RAW = {
  size: '3',
  root: 'aa'.repeat(32),
  tip_block_hash: 'bb'.repeat(32),
  tip_height: '120',
} as const;

export const FIXTURE_ACCUMULATOR: AccumulatorResponse = {
  size: 3n,
  root: 'aa'.repeat(32),
  tip_block_hash: 'bb'.repeat(32),
  tip_height: 120n,
};

export const FIXTURE_INSCRIPTIONS_RAW = {
  inscriptions: [
    {
      txid: 'cc'.repeat(32),
      height: '100',
      tx_index: 1,
      vin_index: 0,
      count: 2,
      format: 1,
      confirmation_state: 'completed',
      nullifiers: [
        {
          pubkey: '11'.repeat(32),
          r: '22'.repeat(32),
          state: 'completed',
        },
        {
          pubkey: '33'.repeat(32),
          r: '44'.repeat(32),
          state: 'pending',
        },
      ],
    },
    {
      txid: 'dd'.repeat(32),
      height: '101',
      tx_index: 0,
      vin_index: 0,
      count: 1,
      format: 0,
      confirmation_state: 'pending',
      nullifiers: [
        {
          pubkey: '55'.repeat(32),
          r: '66'.repeat(32),
          state: 'failed',
        },
      ],
    },
  ],
} as const;

export const FIXTURE_INSCRIPTIONS: InscriptionsResponse = {
  inscriptions: [
    {
      txid: 'cc'.repeat(32),
      height: 100n,
      tx_index: 1,
      vin_index: 0,
      count: 2,
      format: 1,
      confirmation_state: 'completed',
      nullifiers: [
        {
          pubkey: '11'.repeat(32),
          r: '22'.repeat(32),
          state: 'completed',
        },
        {
          pubkey: '33'.repeat(32),
          r: '44'.repeat(32),
          state: 'pending',
        },
      ],
    },
    {
      txid: 'dd'.repeat(32),
      height: 101n,
      tx_index: 0,
      vin_index: 0,
      count: 1,
      format: 0,
      confirmation_state: 'pending',
      nullifiers: [
        {
          pubkey: '55'.repeat(32),
          r: '66'.repeat(32),
          state: 'failed',
        },
      ],
    },
  ],
};

export const FIXTURE_NULLIFIER_PRESENT_RAW = {
  present: true,
  position: '0',
  leaf: '22'.repeat(32),
  audit_path: ['77'.repeat(32)],
  tree_size: '3',
  root: 'aa'.repeat(32),
  tip_block_hash: 'bb'.repeat(32),
  tip_height: '120',
} as const;

export const FIXTURE_NULLIFIER_PRESENT: NullifierLookupResponse = {
  present: true,
  position: 0n,
  leaf: '22'.repeat(32),
  audit_path: ['77'.repeat(32)],
  tree_size: 3n,
  root: 'aa'.repeat(32),
  tip_block_hash: 'bb'.repeat(32),
  tip_height: 120n,
};

export const FIXTURE_NULLIFIER_ABSENT: NullifierLookupResponse = {
  present: false,
  audit_path: [],
  tree_size: 3n,
  root: 'aa'.repeat(32),
  tip_block_hash: 'bb'.repeat(32),
  tip_height: 120n,
};

/** Intentionally corrupt response missing required fields. */
export const FIXTURE_BROKEN_ACCUMULATOR = {
  size: '3',
  // root missing
  tip_block_hash: 'bb'.repeat(32),
  tip_height: '120',
};
