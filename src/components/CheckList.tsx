import type { CheckItem } from '@/lib/bearer/checks';

const STYLES: Record<CheckItem['status'], string> = {
  pass: 'border-ok/40 bg-ok/10 text-ok',
  fail: 'border-bad/40 bg-bad/10 text-bad',
  open: 'border-warn/40 bg-warn/10 text-warn',
};

const LABELS: Record<CheckItem['status'], string> = {
  pass: 'pass',
  fail: 'fail',
  open: 'open',
};

/**
 * Explicit pass / fail / open checklist for bearer verification.
 * Open steps are never styled as verified.
 */
export function CheckList({ checks }: { checks: CheckItem[] }) {
  return (
    <ul data-testid="check-list" className="space-y-2">
      {checks.map((c) => (
        <li
          key={c.id}
          data-testid={`check-${c.id}`}
          data-status={c.status}
          className={`rounded border px-3 py-2 text-sm ${STYLES[c.status]}`}
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-medium text-ink">{c.label}</span>
            <span className="font-mono text-[11px] uppercase tracking-wide">
              {LABELS[c.status]}
            </span>
          </div>
          <p className="mt-1 text-xs text-ink2">{c.detail}</p>
        </li>
      ))}
    </ul>
  );
}
