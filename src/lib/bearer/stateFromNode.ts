/**
 * §3.10 state is always taken from node-supplied data — never classified
 * client-side. Helpers below only select / surface that data.
 */

import type { InscriptionEntry, NullifierState } from '@/lib/api/types';

const STATES = new Set<NullifierState>(['pending', 'completed', 'failed']);

/**
 * Find the §3.10 state for `pkHex` in an inscription page.
 * Returns undefined when the key is absent — never invents a state.
 */
export function stateFromInscriptions(
  pkHex: string,
  inscriptions: InscriptionEntry[],
): { state: NullifierState; txid: string; height: number } | undefined {
  if (typeof pkHex !== 'string' || pkHex.length === 0) {
    throw new Error('stateFromInscriptions: pkHex is required');
  }
  for (const entry of inscriptions) {
    for (const member of entry.nullifiers) {
      if (member.pubkey === pkHex) {
        if (!STATES.has(member.state)) {
          throw new Error(`stateFromInscriptions: unknown state ${JSON.stringify(member.state)}`);
        }
        return { state: member.state, txid: entry.txid, height: entry.height };
      }
    }
  }
  return undefined;
}
