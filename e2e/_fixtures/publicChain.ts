/**
 * Public-mode API fixture data for E2E.
 *
 * Re-exports the unit-test RAW wire shapes (single source of truth) and adds
 * pagination / empty variants used only by Playwright route mocks.
 */

export const E2E_NODE_BASE_URL = 'https://e2e-node.example.invalid';

export {
  FIXTURE_INFO_RAW,
  FIXTURE_ACCUMULATOR_RAW,
  FIXTURE_INSCRIPTIONS_RAW,
  FIXTURE_NULLIFIER_PRESENT_RAW,
  FIXTURE_NULLIFIER_ABSENT,
  FIXTURE_BROKEN_ACCUMULATOR,
} from '@/__tests__/fixtures/public-chain';

import {
  FIXTURE_INSCRIPTIONS_RAW,
  FIXTURE_NULLIFIER_ABSENT,
} from '@/__tests__/fixtures/public-chain';

/**
 * RAW wire form for present:false Path-B answers.
 * The unit fixture is post-parse (bigint); the network layer needs decimal
 * strings so client.ts parsers accept the body.
 */
export const FIXTURE_NULLIFIER_ABSENT_RAW = {
  present: false as const,
  audit_path: [] as string[],
  tree_size: FIXTURE_NULLIFIER_ABSENT.tree_size.toString(10),
  root: FIXTURE_NULLIFIER_ABSENT.root,
  tip_block_hash: FIXTURE_NULLIFIER_ABSENT.tip_block_hash,
  tip_height: FIXTURE_NULLIFIER_ABSENT.tip_height.toString(10),
};

/**
 * First inscriptions page with a pagination cursor so PublicHome shows
 * "Load more inscriptions". Cursor values are the from_* query the second
 * page mock matches.
 */
export const FIXTURE_INSCRIPTIONS_PAGE1_CURSOR = {
  next_height: '102',
  next_tx_index: 0,
  next_vin_index: 0,
} as const;

export const FIXTURE_INSCRIPTIONS_PAGE1_RAW = {
  inscriptions: FIXTURE_INSCRIPTIONS_RAW.inscriptions,
  next_height: FIXTURE_INSCRIPTIONS_PAGE1_CURSOR.next_height,
  next_tx_index: FIXTURE_INSCRIPTIONS_PAGE1_CURSOR.next_tx_index,
  next_vin_index: FIXTURE_INSCRIPTIONS_PAGE1_CURSOR.next_vin_index,
} as const;

/** Second page (exhausted — no next_* cursor fields). */
export const FIXTURE_INSCRIPTIONS_PAGE2_RAW = {
  inscriptions: [
    {
      txid: 'ee'.repeat(32),
      height: '102',
      tx_index: 0,
      vin_index: 0,
      count: 1,
      format: 0,
      confirmation_state: 'completed',
      nullifiers: [
        {
          pubkey: '99'.repeat(32),
          r: 'aa'.repeat(32),
          state: 'completed',
        },
      ],
    },
  ],
} as const;

/** Empty page for the empty-state screenshot. */
export const FIXTURE_INSCRIPTIONS_EMPTY_RAW = {
  inscriptions: [] as const,
};
