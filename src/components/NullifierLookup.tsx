'use client';

import { useState, type FormEvent } from 'react';
import { fetchNullifier } from '@/lib/api/client';
import { mapNullifierLookup, type PublicNullifierLookup } from '@/lib/api/map';
import { NodeApiError } from '@/lib/api/types';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';

const HEX64 = /^[0-9a-fA-F]{64}$/;

/**
 * Path-B nullifier membership lookup (§7.5 / §3.7).
 * UI always surfaces the caveat that the client must verify against its own scan.
 */
export function NullifierLookupPanel() {
  const [pubkey, setPubkey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PublicNullifierLookup | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    const trimmed = pubkey.trim();
    if (!HEX64.test(trimmed)) {
      setError('Pubkey must be 64 hex characters (x-only Pkᵢ).');
      return;
    }
    setLoading(true);
    try {
      const raw = await fetchNullifier(trimmed.toLowerCase());
      setResult(mapNullifierLookup(raw));
    } catch (err) {
      if (err instanceof NodeApiError) {
        setError(`${err.code}: ${err.message}`);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(String(err));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div data-testid="nullifier-lookup" className="space-y-4">
      <form onSubmit={onSubmit} className="space-y-3 rounded border border-line bg-surface p-4">
        <label className="block text-sm">
          <span className="text-[10px] uppercase tracking-widest text-ink3">Pkᵢ (hex)</span>
          <input
            data-testid="nullifier-input"
            className="mt-1 w-full rounded border border-line2 bg-bg px-3 py-2 font-mono text-sm text-ink outline-none focus:border-bitcoin"
            value={pubkey}
            onChange={(ev) => setPubkey(ev.target.value)}
            placeholder="64 hex chars"
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <button
          type="submit"
          data-testid="nullifier-submit"
          className="rounded bg-bitcoin px-3 py-1.5 text-sm font-medium text-black hover:bg-bitcoin-hover"
          disabled={loading}
        >
          Look up
        </button>
      </form>

      {loading ? <LoadingState label="Looking up nullifier…" /> : null}
      {error !== null ? <ErrorState title="Lookup failed" message={error} /> : null}

      {result !== null ? (
        <div
          data-testid="nullifier-result"
          className="space-y-3 rounded border border-line bg-surface p-4"
        >
          <p
            data-testid="nullifier-caveat"
            className="rounded border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn"
          >
            Path-B answer from this node. A client MUST verify membership against its own scan — the
            explorer asserts no authority it does not have (§5.5 / §3.7).
          </p>
          <dl className="grid gap-2 font-mono text-xs sm:grid-cols-2">
            <div>
              <dt className="text-ink3">present</dt>
              <dd data-testid="nullifier-present">{String(result.present)}</dd>
            </div>
            <div>
              <dt className="text-ink3">tree_size</dt>
              <dd>{result.tree_size}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-ink3">nav_root</dt>
              <dd className="break-all">{result.nav_root}</dd>
            </div>
            <div>
              <dt className="text-ink3">tip_height</dt>
              <dd>{result.tip_height}</dd>
            </div>
            <div>
              <dt className="text-ink3">tip_block_hash</dt>
              <dd className="break-all">{result.tip_block_hash}</dd>
            </div>
            {result.present ? (
              <>
                <div>
                  <dt className="text-ink3">position</dt>
                  <dd data-testid="nullifier-position">{result.position}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-ink3">leaf (Rᵢ)</dt>
                  <dd className="break-all">{result.leaf}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-ink3">audit_path ({result.audit_path.length})</dt>
                  <dd>
                    <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
                      {result.audit_path.map((h, i) => (
                        <li key={`${i}-${h}`} className="break-all text-ink2">
                          [{i}] {h}
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              </>
            ) : (
              <p className="sm:col-span-2 text-ink3">
                present: false is an unauthenticated local-index absence answer — not an RFC-6962
                non-inclusion proof. It MUST NOT back a credit.
              </p>
            )}
          </dl>
        </div>
      ) : null}
    </div>
  );
}
