/**
 * stateFromInscriptions fail-closed guards.
 */

import { describe, expect, it } from 'vitest';
import { stateFromInscriptions } from '@/lib/bearer/stateFromNode';
import type { InscriptionEntry, NullifierState } from '@/lib/api/types';

const baseEntry: InscriptionEntry = {
  txid: 'bb'.repeat(32),
  height: 1n,
  tx_index: 0,
  vin_index: 0,
  count: 1,
  format: 1,
  nullifiers: [{ pubkey: 'aa'.repeat(32), r: 'cc'.repeat(32), state: 'pending' }],
  confirmation_state: 'pending',
};

describe('stateFromInscriptions', () => {
  it('throws when pkHex is empty', () => {
    expect(() =>
      stateFromInscriptions(7 as unknown as string, 'cc'.repeat(32), [baseEntry]),
    ).toThrow(/pkHex/);
    expect(() => stateFromInscriptions('', 'cc'.repeat(32), [baseEntry])).toThrow(/pkHex/);
  });

  it('throws when rHex is empty', () => {
    expect(() =>
      stateFromInscriptions('aa'.repeat(32), 7 as unknown as string, [baseEntry]),
    ).toThrow(/rHex/);
    expect(() => stateFromInscriptions('aa'.repeat(32), '', [baseEntry])).toThrow(/rHex/);
  });

  it('throws on unknown state string from node data', () => {
    const entry: InscriptionEntry = {
      ...baseEntry,
      nullifiers: [
        {
          pubkey: 'aa'.repeat(32),
          r: 'cc'.repeat(32),
          state: 'mystery' as NullifierState,
        },
      ],
    };
    expect(() => stateFromInscriptions('aa'.repeat(32), 'cc'.repeat(32), [entry])).toThrow(
      /unknown state/,
    );
  });

  it('returns hit for a matching pair', () => {
    const hit = stateFromInscriptions('aa'.repeat(32), 'cc'.repeat(32), [baseEntry]);
    expect(hit).toEqual({ state: 'pending', txid: baseEntry.txid, height: 1n });
  });
});
