import type { PublicAccumulatorView, PublicNetworkInfo } from '@/lib/api/map';

/**
 * Public accumulator view: size + nav_root, tip anchor, network context.
 * Bare mth is not on the §7.5 wire (`root` is always nav_root).
 */
export function AccumulatorPanel({
  accumulator,
  info,
}: {
  accumulator: PublicAccumulatorView;
  info: PublicNetworkInfo;
}) {
  return (
    <div data-testid="accumulator-view" className="space-y-4">
      <section className="grid gap-3 rounded border border-line bg-surface p-4 sm:grid-cols-2">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-ink3">size</p>
          <p className="mt-1 font-mono text-2xl tabular-nums">{accumulator.size}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-ink3">nav_root</p>
          <p className="mt-1 break-all font-mono text-sm" title={accumulator.nav_root}>
            {accumulator.nav_root}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-ink3">tip_height</p>
          <p className="mt-1 font-mono text-lg tabular-nums">{accumulator.tip_height}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-ink3">tip_block_hash</p>
          <p className="mt-1 break-all font-mono text-sm">{accumulator.tip_block_hash}</p>
        </div>
      </section>

      <section className="rounded border border-line bg-surface p-4 text-sm text-ink2">
        <p className="text-[10px] uppercase tracking-widest text-ink3">Network</p>
        <ul className="mt-2 space-y-1 font-mono text-xs">
          <li>network: {info.network}</li>
          <li>protocol_version: {info.protocol_version}</li>
          <li>finality_confirmations: {info.finality_confirmations}</li>
          <li>activation_height: {info.activation_height}</li>
        </ul>
      </section>
    </div>
  );
}
