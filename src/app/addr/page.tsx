import { BearerRoutePanel } from '@/components/BearerRoutePanel';

/**
 * Account-view link route (§5.8).
 *
 * Path is only `/addr`. Address and zkavk live in the fragment; client-side
 * parse only — never query, never SSR of secret material.
 */
export default function AddrPage() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">Account view link</h2>
        <p className="text-sm text-ink2">
          Bearer route · account layer · fragment-only secret transport
        </p>
      </div>
      <BearerRoutePanel kind="addr" />
    </div>
  );
}
