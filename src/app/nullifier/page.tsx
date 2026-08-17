import { NullifierLookupPanel } from '@/components/NullifierLookup';

export default function NullifierPage() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">Nullifier lookup</h2>
        <p className="text-sm text-ink2">
          GET /v1/chain/nullifier/&lt;pk&gt; — Path-B membership answer. Check against your own
          scan.
        </p>
      </div>
      <NullifierLookupPanel />
    </div>
  );
}
