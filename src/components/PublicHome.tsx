'use client';

import { useCallback, useEffect, useState } from 'react';
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

interface PageCursor {
  next_height: bigint;
  next_tx_index: number;
  next_vin_index: number;
}

interface Loaded {
  inscriptions: PublicInscription[];
  /** Counts over the loaded page subset only — never claimed as the full chain. */
  counts: PublicAggregateCounts;
  accumulator: PublicAccumulatorView;
  info: PublicNetworkInfo;
  cursor: PageCursor | null;
  pageSize: number;
}

const PAGE_LIMIT = 100;

/**
 * Public mode home: paginated inscription stream + page-local aggregate counts (§5.5).
 * Failed or malformed API responses surface as ErrorState — never empty success.
 * Cursor is preserved so later pages can be loaded; counts are labelled as a page subset.
 */
export function PublicHome() {
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Loaded | null>(null);

  const loadInitial = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const [infoRaw, accRaw, insRaw] = await Promise.all([
        fetchInfo({ signal }),
        fetchAccumulator({ signal }),
        fetchInscriptions({ limit: PAGE_LIMIT, signal }),
      ]);
      const info = mapInfo(infoRaw);
      const accumulator = mapAccumulator(accRaw);
      const inscriptions = mapInscriptions(insRaw);
      const counts = computeAggregateCounts(inscriptions, accumulator.size);
      const cursor =
        insRaw.next_height !== undefined &&
        insRaw.next_tx_index !== undefined &&
        insRaw.next_vin_index !== undefined
          ? {
              next_height: insRaw.next_height,
              next_tx_index: insRaw.next_tx_index,
              next_vin_index: insRaw.next_vin_index,
            }
          : null;
      setData({
        inscriptions,
        counts,
        accumulator,
        info,
        cursor,
        pageSize: PAGE_LIMIT,
      });
    } catch (err) {
      if (signal.aborted) {
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
      if (!signal.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void loadInitial(ac.signal);
    return () => ac.abort();
  }, [loadInitial]);

  const loadMore = useCallback(async () => {
    if (data === null || data.cursor === null || loadingMore) {
      /* v8 ignore next -- the `data.cursor === null` disjunct is unreachable — the load-more control only renders while cursor !== null, and any concurrent loadMore short-circuits on `loadingMore` (still true, cursor still the old non-null value) before the cursor check; a click on the unmounted button cannot re-enter React's handler */
      return;
    }
    setLoadingMore(true);
    setError(null);
    try {
      const insRaw = await fetchInscriptions({
        limit: PAGE_LIMIT,
        from_height: data.cursor.next_height,
        from_tx_index: data.cursor.next_tx_index,
        from_vin_index: data.cursor.next_vin_index,
      });
      const nextPage = mapInscriptions(insRaw);
      const inscriptions = [...data.inscriptions, ...nextPage];
      const counts = computeAggregateCounts(inscriptions, data.accumulator.size);
      const cursor =
        insRaw.next_height !== undefined &&
        insRaw.next_tx_index !== undefined &&
        insRaw.next_vin_index !== undefined
          ? {
              next_height: insRaw.next_height,
              next_tx_index: insRaw.next_tx_index,
              next_vin_index: insRaw.next_vin_index,
            }
          : null;
      setData({
        ...data,
        inscriptions,
        counts,
        cursor,
      });
    } catch (err) {
      if (err instanceof NodeApiError) {
        setError(`${err.code}: ${err.message}`);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(String(err));
      }
    } finally {
      setLoadingMore(false);
    }
  }, [data, loadingMore]);

  if (loading) {
    return <LoadingState label="Loading public chain projection…" />;
  }
  if (error !== null && data === null) {
    return <ErrorState title="Failed to load public data" message={error} />;
  }
  /* v8 ignore next 3 -- loadInitial's success path sets data non-null in
     the same batched update as loading=false; its failure path sets
     error non-null too, caught by the error!==null&&data===null check
     above first */
  if (data === null) {
    return <ErrorState title="Failed to load public data" message="No data returned" />;
  }

  const hasMore = data.cursor !== null;
  const pageNote = hasMore
    ? `Showing a loaded page subset (${data.inscriptions.length} inscriptions so far; more available). Inscription count and transitions/block are for this loaded subset only — not the full chain. Accumulator size is global.`
    : `Showing ${data.inscriptions.length} inscription(s) loaded. Inscription count and transitions/block are for this loaded set; accumulator size is global.`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-medium">Nullifier inscription stream</h2>
          <p className="text-sm text-ink2">
            AggregateStateNullifierV3 on Bitcoin · half-aggregated (Pkⱼ, Rⱼ) · first-occurrence
            accumulator
          </p>
          <p data-testid="pagination-note" className="mt-1 text-xs text-ink3">
            {pageNote}
          </p>
        </div>
        <p className="font-mono text-xs text-ink3">
          {data.info.network} · tip {data.accumulator.tip_height}
        </p>
      </div>
      <InscriptionList
        inscriptions={data.inscriptions}
        counts={data.counts}
        countsScopeLabel="loaded subset"
      />
      {error !== null && <ErrorState title="Failed to load more inscriptions" message={error} />}
      {hasMore && (
        <div className="flex justify-center">
          <button
            type="button"
            data-testid="load-more-inscriptions"
            className="rounded border border-line bg-surface px-4 py-2 text-sm text-ink hover:border-line2 disabled:opacity-50"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? 'Loading…' : 'Load more inscriptions'}
          </button>
        </div>
      )}
    </div>
  );
}
