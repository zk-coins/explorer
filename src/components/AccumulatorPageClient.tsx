'use client';

import { useEffect, useState } from 'react';
import { fetchAccumulator, fetchInfo } from '@/lib/api/client';
import {
  mapAccumulator,
  mapInfo,
  type PublicAccumulatorView,
  type PublicNetworkInfo,
} from '@/lib/api/map';
import { NodeApiError } from '@/lib/api/types';
import { AccumulatorPanel } from '@/components/AccumulatorView';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';

export function AccumulatorPageClient() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accumulator, setAccumulator] = useState<PublicAccumulatorView | null>(null);
  const [info, setInfo] = useState<PublicNetworkInfo | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [infoRaw, accRaw] = await Promise.all([
          fetchInfo({ signal: ac.signal }),
          fetchAccumulator({ signal: ac.signal }),
        ]);
        setInfo(mapInfo(infoRaw));
        setAccumulator(mapAccumulator(accRaw));
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
        setAccumulator(null);
        setInfo(null);
      } finally {
        if (!ac.signal.aborted) {
          setLoading(false);
        }
      }
    })();
    return () => ac.abort();
  }, []);

  if (loading) {
    return <LoadingState label="Loading accumulator…" />;
  }
  if (error !== null) {
    return <ErrorState title="Failed to load accumulator" message={error} />;
  }
  if (accumulator === null || info === null) {
    return <ErrorState title="Failed to load accumulator" message="No data returned" />;
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">Nullifier accumulator</h2>
        <p className="text-sm text-ink2">
          Global first-occurrence fold of on-chain (Pkⱼ, Rⱼ). root on the wire is nav_root (§7.5).
        </p>
      </div>
      <AccumulatorPanel accumulator={accumulator} info={info} />
    </div>
  );
}
