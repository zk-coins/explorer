import { BearerRoutePanel } from '@/components/BearerRoutePanel';

/**
 * Balance-attestation link route (§5.7).
 *
 * Path is only `/balance`. Address, asset_id, and attestation live in the
 * fragment; client-side parse only — never query, never SSR of secret material.
 */
export default function BalancePage() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">Balance attestation link</h2>
        <p className="text-sm text-ink2">
          Bearer route · account layer · fragment-only secret transport
        </p>
      </div>
      <BearerRoutePanel kind="balance" />
    </div>
  );
}
