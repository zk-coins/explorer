import { BearerRoutePanel } from '@/components/BearerRoutePanel';

/**
 * Confirmation-link route (§5.6).
 *
 * Path is only `/tx`. The zkbid/zkview pair lives in the URL fragment and is
 * parsed exclusively client-side — never server-rendered from link contents,
 * never placed in a query string, never sent over the network from this route.
 */
export default function TxPage() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">Confirmation link</h2>
        <p className="text-sm text-ink2">
          Bearer route · account layer · fragment-only secret transport
        </p>
      </div>
      <BearerRoutePanel kind="tx" />
    </div>
  );
}
