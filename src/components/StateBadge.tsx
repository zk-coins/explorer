import type { ConfirmationState, NullifierState } from '@/lib/api/types';

const STYLES: Record<string, string> = {
  completed: 'bg-ok/15 text-ok',
  pending: 'bg-warn/15 text-warn',
  failed: 'bg-bad/15 text-bad',
};

export function StateBadge({ state }: { state: NullifierState | ConfirmationState }) {
  const cls = STYLES[state];
  if (cls === undefined) {
    throw new Error(`StateBadge: unknown state ${JSON.stringify(state)}`);
  }
  return (
    <span
      data-testid={`state-${state}`}
      className={`inline-block rounded px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wide ${cls}`}
    >
      {state}
    </span>
  );
}
