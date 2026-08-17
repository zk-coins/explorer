/**
 * Visible error state for failed/missing API data.
 * Missing data is never rendered as an empty success.
 */
export function ErrorState({ title, message }: { title: string; message: string }) {
  return (
    <div
      role="alert"
      data-testid="error-state"
      className="rounded border border-bad/40 bg-bad/10 px-4 py-3 text-sm"
    >
      <p className="font-medium text-bad">{title}</p>
      <p className="mt-1 text-ink2">{message}</p>
    </div>
  );
}
