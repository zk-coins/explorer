/**
 * §3.10 state is always taken from node-supplied data — never classified
 * client-side. Helpers below only select / surface that data.
 */

import type { InscriptionEntry, NullifierState } from '@/lib/api/types';

const STATES = new Set<NullifierState>(['pending', 'completed', 'failed']);

/**
 * Find the §3.10 state for the exact nullifier pair `(Pk_create, R_create)`.
 * Matching only the public key is wrong: a completed inscription for the same
 * Pk with a different R must not surface as this coin's state.
 * Returns undefined when the pair is absent — never invents a state.
 */
export function stateFromInscriptions(
  pkHex: string,
  rHex: string,
  inscriptions: InscriptionEntry[],
): { state: NullifierState; txid: string; height: bigint } | undefined {
  if (typeof pkHex !== 'string' || pkHex.length === 0) {
    throw new Error('stateFromInscriptions: pkHex is required');
  }
  if (typeof rHex !== 'string' || rHex.length === 0) {
    throw new Error('stateFromInscriptions: rHex is required');
  }
  for (const entry of inscriptions) {
    for (const member of entry.nullifiers) {
      if (member.pubkey === pkHex && member.r === rHex) {
        if (!STATES.has(member.state)) {
          throw new Error(`stateFromInscriptions: unknown state ${JSON.stringify(member.state)}`);
        }
        return { state: member.state, txid: entry.txid, height: entry.height };
      }
    }
  }
  return undefined;
}
