import type { PublicAggregateCounts, PublicInscription } from '@/lib/api/map';
import { StateBadge } from '@/components/StateBadge';

function shortHex(hex: string, head = 8, tail = 6): string {
  if (hex.length <= head + tail + 1) {
    return hex;
  }
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

/**
 * Public-mode inscription stream: AggregateStateNullifierV3 entries with
 * half-aggregated (Pkⱼ, Rⱼ) sets, reveal txid (publisher Bitcoin identity),
 * height, confirmations state, and per-member §3.10 state from the node.
 *
 * MUST NOT render amounts, assets, parties, or an output graph (§5.5).
 */
export function InscriptionList({
  inscriptions,
  counts,
}: {
  inscriptions: PublicInscription[];
  counts: PublicAggregateCounts;
}) {
  return (
    <div data-testid="inscription-list" className="space-y-6">
      <section
        data-testid="aggregate-counts"
        className="grid gap-3 rounded border border-line bg-surface p-4 sm:grid-cols-3"
      >
        <div>
          <p className="text-[10px] uppercase tracking-widest text-ink3">Inscriptions</p>
          <p className="mt-1 font-mono text-xl tabular-nums">{counts.inscription_count}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-ink3">Accumulator size</p>
          <p className="mt-1 font-mono text-xl tabular-nums">{counts.accumulator_size}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-ink3">Transitions / block</p>
          {counts.transitions_per_block.length === 0 ? (
            <p className="mt-1 text-sm text-ink3">—</p>
          ) : (
            <ul className="mt-1 space-y-0.5 font-mono text-sm tabular-nums">
              {counts.transitions_per_block.map((row) => (
                <li key={row.height}>
                  h{row.height}: {row.transitions}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {inscriptions.length === 0 ? (
        <p className="text-sm text-ink3" data-testid="inscriptions-empty">
          No inscriptions in this page.
        </p>
      ) : (
        <ul className="space-y-4">
          {inscriptions.map((ins) => (
            <li
              key={`${ins.txid}-${ins.vin_index}`}
              data-testid="inscription-card"
              className="rounded border border-line bg-surface p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-ink3">
                    AggregateStateNullifierV3 · reveal
                  </p>
                  <p className="mt-1 break-all font-mono text-sm" title={ins.txid}>
                    txid {ins.txid}
                  </p>
                  <p className="mt-1 text-xs text-ink2">
                    height {ins.height} · tx_index {ins.tx_index} · vin_index {ins.vin_index} ·
                    format {ins.format} · members {ins.count}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-widest text-ink3">
                    confirmation_state
                  </p>
                  <div className="mt-1">
                    <StateBadge state={ins.confirmation_state} />
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <p className="text-[10px] uppercase tracking-widest text-ink3">
                  Half-aggregated (Pkⱼ, Rⱼ)
                </p>
                <p className="mt-1 text-xs text-ink3">
                  Public mode does not link any Pkⱼ to an account or transaction.
                </p>
                <ul className="mt-2 divide-y divide-line">
                  {ins.nullifiers.map((n, i) => (
                    <li
                      key={`${n.pubkey}-${i}`}
                      data-testid="nullifier-member"
                      className="flex flex-wrap items-center justify-between gap-2 py-2 font-mono text-xs"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <p title={n.pubkey}>Pk {shortHex(n.pubkey, 12, 8)}</p>
                        <p className="text-ink3" title={n.r}>
                          R {shortHex(n.r, 12, 8)}
                        </p>
                      </div>
                      <StateBadge state={n.state} />
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
