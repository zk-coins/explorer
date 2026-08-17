export function LoadingState({ label }: { label: string }) {
  return (
    <p data-testid="loading-state" className="text-sm text-ink3">
      {label}
    </p>
  );
}
