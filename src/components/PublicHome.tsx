'use client';

import { useEffect, useState } from 'react';
import { fetchAccumulator, fetchInfo, fetchInscriptions } from '@/lib/api/client';
import {
  computeAggregateCounts,
  mapAccumulator,
  mapInfo,
  mapInscriptions,
  type PublicAggregateCounts,
  type PublicAccumulatorView,
  type PublicInscription,
  type PublicNetworkInfo,
} from '@/lib/api/map';
import { NodeApiError } from '@/lib/api/types';
import { ErrorState } from '@/components/ErrorState';
import { InscriptionList } from '@/components/InscriptionList';
import { LoadingState } from '@/components/LoadingState';

interface Loaded {
  inscriptions: PublicInscription[];
  counts: PublicAggregateCounts;
  accumulator: PublicAccumulatorView;
  info: PublicNetworkInfo;
}

/**
 * Public mode home: inscription stream + aggregate counts (§5.5).
 * Failed or malformed API responses surface as ErrorState — never empty success.
 */
export function PublicHome() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Loaded | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [infoRaw, accRaw, insRaw] = await Promise.all([
          fetchInfo({ signal: ac.signal }),
          fetchAccumulator({ signal: ac.signal }),
          fetchInscriptions({ limit: 100, signal: ac.signal }),
        ]);
        const info = mapInfo(infoRaw);
        const accumulator = mapAccumulator(accRaw);
        const inscriptions = mapInscriptions(insRaw);
        const counts = computeAggregateCounts(inscriptions, accumulator.size);
        setData({ inscriptions, counts, accumulator, info });
      } catch (err) {
        if (ac.signal.aborted) {
          return;
        }
        if (err instanceof NodeApiError) {
          setError(`${err.code}: ${err.message}`);
        } else if (err instanceof Error) {
          setError(err.message);
        } else {
          setError(String(err));
        }
        setData(null);
      } finally {
        if (!ac.signal.aborted) {
          setLoading(false);
        }
      }
    })();
    return () => ac.abort();
  }, []);

  if (loading) {
    return <LoadingState label="Loading public chain projection…" />;
  }
  if (error !== null) {
    return <ErrorState title="Failed to load public data" message={error} />;
  }
  if (data === null) {
    return <ErrorState title="Failed to load public data" message="No data returned" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-medium">Nullifier inscription stream</h2>
          <p className="text-sm text-ink2">
            AggregateStateNullifierV3 on Bitcoin · half-aggregated (Pkⱼ, Rⱼ) · first-occurrence
            accumulator
          </p>
        </div>
        <p className="font-mono text-xs text-ink3">
          {data.info.network} · tip {data.accumulator.tip_height}
        </p>
      </div>
      <InscriptionList inscriptions={data.inscriptions} counts={data.counts} />
    </div>
  );
}
