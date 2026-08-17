'use client';

import { useEffect, useState } from 'react';
import { CheckList } from '@/components/CheckList';
import { ErrorState } from '@/components/ErrorState';
import { StateBadge } from '@/components/StateBadge';
import { resolveAddressView, type AddressViewResult } from '@/lib/bearer/addressView';
import { resolveBalanceAttestation, type BalanceAttestationView } from '@/lib/bearer/balance';
import { resolveConfirmationLink, type ConfirmationView } from '@/lib/bearer/confirmation';
import {
  parseAddrFragment,
  parseBalanceFragment,
  parseTxFragment,
  readLocationHash,
  type AddrFragmentResult,
  type BalanceFragmentResult,
  type TxFragmentResult,
} from '@/lib/fragments';

type Kind = 'tx' | 'balance' | 'addr';

/**
 * Client-only bearer-link shell.
 *
 * Secrets are read exclusively from `window.location.hash` (fragment). They
 * must never be copied into a query string, a path beyond this static route,
 * server props, or any network request (spec §5.6).
 */
export function BearerRoutePanel({ kind }: { kind: Kind }) {
  const [tx, setTx] = useState<TxFragmentResult | null>(null);
  const [balance, setBalance] = useState<BalanceFragmentResult | null>(null);
  const [addr, setAddr] = useState<AddrFragmentResult | null>(null);
  /** Bumps on every hash parse so child bodies remount and drop stale views. */
  const [fragmentEpoch, setFragmentEpoch] = useState(0);

  useEffect(() => {
    // Client-only: fragment is never available to the static export server.
    // Do not move this parse into a server component or pass the hash via query.
    const parse = () => {
      const hash = readLocationHash();
      // Clear sibling kinds so a cross-route soft navigation never shows stale data.
      if (kind === 'tx') {
        setTx(parseTxFragment(hash));
        setBalance(null);
        setAddr(null);
      } else if (kind === 'balance') {
        setBalance(parseBalanceFragment(hash));
        setTx(null);
        setAddr(null);
      } else {
        setAddr(parseAddrFragment(hash));
        setTx(null);
        setBalance(null);
      }
      setFragmentEpoch((e) => e + 1);
    };
    parse();
    // Fragment-only navigation does not remount the route — re-parse on hashchange.
    window.addEventListener('hashchange', parse);
    return () => {
      window.removeEventListener('hashchange', parse);
    };
  }, [kind]);

  if (kind === 'tx') {
    return <TxBody key={`tx-${fragmentEpoch}`} result={tx} />;
  }
  if (kind === 'balance') {
    return <BalanceBody key={`balance-${fragmentEpoch}`} result={balance} />;
  }
  return <AddrBody key={`addr-${fragmentEpoch}`} result={addr} />;
}

function TxBody({ result }: { result: TxFragmentResult | null }) {
  const [view, setView] = useState<ConfirmationView | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (result === null || result.status !== 'ok') {
      setView(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    resolveConfirmationLink(result, { maxInscriptionPages: 50 })
      .then((v) => {
        if (!cancelled) {
          setView(v);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setView({
            checks: [],
            fatalError: err instanceof Error ? err.message : String(err),
          });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [result]);

  if (result === null) {
    return <p className="text-sm text-ink3">Reading fragment…</p>;
  }
  if (result.status === 'empty') {
    return (
      <EmptyFragment title="Confirmation link" grammar="https://<explorer>/tx#<zkbid>/<zkview>" />
    );
  }
  if (result.status === 'error') {
    return <ErrorState title="Invalid confirmation link" message={result.message} />;
  }
  if (loading || view === null) {
    return <p className="text-sm text-ink3">Decrypting confirmation…</p>;
  }

  return (
    <div data-testid="confirmation-view" className="space-y-4">
      {view.fatalError !== undefined && (
        <ErrorState title="Confirmation failed" message={view.fatalError} />
      )}
      {view.state !== undefined && view.fatalError === undefined && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-ink2">§3.10 state</span>
          <StateBadge state={view.state} />
        </div>
      )}
      {view.coin !== undefined && view.fatalError === undefined && (
        <section
          data-testid="coin-fields"
          className="space-y-1 rounded border border-line bg-surface p-4 text-sm"
        >
          <h3 className="font-medium">Coin</h3>
          <Field label="amount" value={view.coin.amount} />
          <Field label="asset_id" value={view.coin.assetIdHex} mono />
          <Field label="recipient" value={view.coin.recipientHex} mono />
          <Field label="identifier" value={view.coin.identifierHex} mono />
          {view.assetTermsName !== undefined && (
            <Field label="asset name" value={view.assetTermsName} />
          )}
        </section>
      )}
      {view.creatingNullifier !== undefined && view.fatalError === undefined && (
        <section
          data-testid="anchoring-trail"
          className="space-y-1 rounded border border-line bg-surface p-4 text-sm"
        >
          <h3 className="font-medium">Anchoring trail</h3>
          <Field label="Pk_create" value={view.creatingNullifier.pkCreateHex} mono />
          <Field label="R_create" value={view.creatingNullifier.rCreateHex} mono />
          {view.anchoring?.revealTxid !== undefined && (
            <Field label="reveal txid" value={view.anchoring.revealTxid} mono />
          )}
          {view.anchoring?.height !== undefined && (
            <Field label="height" value={String(view.anchoring.height)} />
          )}
          {view.anchoring?.confirmations !== undefined && (
            <Field label="confirmations" value={String(view.anchoring.confirmations)} />
          )}
          {view.anchoring?.tipHeight !== undefined && (
            <Field label="tip_height" value={String(view.anchoring.tipHeight)} />
          )}
          {view.navOpening !== undefined && <Field label="nav size" value={view.navOpening.size} />}
        </section>
      )}
      <section className="space-y-2">
        <h3 className="text-sm font-medium">Verification checklist (§5.6)</h3>
        <CheckList checks={view.checks} />
      </section>
    </div>
  );
}

function BalanceBody({ result }: { result: BalanceFragmentResult | null }) {
  const [view, setView] = useState<BalanceAttestationView | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (result === null || result.status !== 'ok') {
      setView(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    resolveBalanceAttestation(result)
      .then((v) => {
        if (!cancelled) {
          setView(v);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setView({
            checks: [],
            fatalError: err instanceof Error ? err.message : String(err),
          });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [result]);

  if (result === null) {
    return <p className="text-sm text-ink3">Reading fragment…</p>;
  }
  if (result.status === 'empty') {
    return (
      <EmptyFragment
        title="Balance attestation link"
        grammar="https://<explorer>/balance#<zk-address>/<asset_id>/h:<zkatt>"
      />
    );
  }
  if (result.status === 'error') {
    return <ErrorState title="Invalid balance link" message={result.message} />;
  }
  if (loading || view === null) {
    return <p className="text-sm text-ink3">Verifying balance attestation…</p>;
  }

  return (
    <div data-testid="balance-attestation-view" className="space-y-4">
      {view.fatalError !== undefined && (
        <ErrorState title="Attestation failed" message={view.fatalError} />
      )}
      {view.fields !== undefined && view.fatalError === undefined && (
        <section
          data-testid="attestation-fields"
          className="space-y-1 rounded border border-line bg-surface p-4 text-sm"
        >
          <h3 className="font-medium">BalanceAttestation public inputs</h3>
          <Field label="subject" value={view.fields.subjectHex} mono />
          <Field label="asset_id" value={view.fields.assetIdHex} mono />
          <Field label="balance" value={view.fields.balance} />
          <Field label="nav_ceiling" value={view.fields.navCeilingHex} mono />
          <Field label="size_ceiling" value={view.fields.sizeCeiling} />
          <Field label="anchor.txid" value={view.fields.txidHex} mono />
          <Field label="anchor.block_hash" value={view.fields.blockHashHex} mono />
          <Field label="anchor.height" value={view.fields.height} />
          <Field label="Pk_anchor" value={view.fields.pkAnchorHex} mono />
          <Field label="R_anchor" value={view.fields.rAnchorHex} mono />
          <Field label="network_id" value={view.fields.networkIdHex} mono />
          <Field label="proof length" value={String(view.fields.proofLen)} />
        </section>
      )}
      <section className="space-y-2">
        <h3 className="text-sm font-medium">Verification checklist (§5.7)</h3>
        <CheckList checks={view.checks} />
      </section>
    </div>
  );
}

function AddrBody({ result }: { result: AddrFragmentResult | null }) {
  const [view, setView] = useState<AddressViewResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (result === null || result.status !== 'ok') {
      setView(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    resolveAddressView(result)
      .then((v) => {
        if (!cancelled) {
          setView(v);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setView({
            mode: result.avkByteLength === 32 ? 'incoming_only' : 'full',
            addressHex: '',
            checks: [],
            history: [],
            fatalError: err instanceof Error ? err.message : String(err),
          });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [result]);

  if (result === null) {
    return <p className="text-sm text-ink3">Reading fragment…</p>;
  }
  if (result.status === 'empty') {
    return (
      <EmptyFragment
        title="Account view link"
        grammar="https://<explorer>/addr#<zk-address>/<zkavk>"
      />
    );
  }
  if (result.status === 'error') {
    return <ErrorState title="Invalid account view link" message={result.message} />;
  }
  if (loading || view === null) {
    return <p className="text-sm text-ink3">Opening account view…</p>;
  }

  return (
    <div data-testid="address-view" className="space-y-4">
      {view.fatalError !== undefined && (
        <ErrorState title="Account view failed" message={view.fatalError} />
      )}
      <section className="rounded border border-line bg-surface p-4 text-sm">
        <h3 className="font-medium">Account view mode</h3>
        <p data-testid="avk-mode" className="mt-1 font-mono text-xs text-ink2">
          {view.mode === 'full' ? 'full (ivk ‖ ovk, 64 B)' : 'incoming-only (ivk, 32 B)'}
        </p>
        {view.addressHex.length > 0 && <Field label="address" value={view.addressHex} mono />}
      </section>

      <section data-testid="history-list" className="space-y-2">
        <h3 className="text-sm font-medium">History</h3>
        {view.historyNotResolvable === true && (
          <div
            data-testid="history-not-resolvable"
            className="rounded border border-warn/40 bg-warn/10 p-3 text-sm"
          >
            <p className="text-xs uppercase tracking-wide text-warn">
              history · not yet resolvable in this build
            </p>
            <p className="mt-1 text-ink2">
              {view.historyGap === 'empty_unverified'
                ? 'An empty list below is not a verified "no payments" result.'
                : view.historyGap === 'partial_unresolved' ||
                    view.historyGap === 'rejected_candidate'
                  ? 'History is incomplete; unresolved or rejected candidates remain.'
                  : 'Nostr mesh discovery did not yield resolvable history for this link (no holder/relay scan result). An empty list below is not a verified "no payments" result.'}
            </p>
          </div>
        )}
        {view.history.length === 0 && view.historyNotResolvable !== true && (
          <p className="text-sm text-ink3">No discovered entries in the supplied discovery set.</p>
        )}
        {view.history.map((entry, i) => {
          if (entry.side === 'incoming') {
            return (
              <div
                key={`in-${i}`}
                data-testid="history-incoming"
                className="rounded border border-line bg-surface p-3 text-sm"
              >
                <p className="text-xs uppercase tracking-wide text-ink3">incoming · decoded</p>
                <Field label="amount" value={entry.coin.amount} />
                <Field label="asset_id" value={entry.coin.assetIdHex} mono />
                <Field label="Pk_create" value={entry.creatingPkHex} mono />
              </div>
            );
          }
          if (entry.status === 'not_derivable') {
            return (
              <div
                key={`out-nd-${i}`}
                data-testid="history-outgoing-not-derivable"
                className="rounded border border-warn/40 bg-warn/10 p-3 text-sm"
              >
                <p className="text-xs uppercase tracking-wide text-warn">
                  outgoing · not derivable
                </p>
                <p className="mt-1 text-ink2">{entry.reason}</p>
              </div>
            );
          }
          if (entry.status === 'unresolved') {
            return (
              <div
                key={`out-ur-${i}`}
                data-testid="history-outgoing-unresolved"
                className="rounded border border-warn/40 bg-warn/10 p-3 text-sm"
              >
                <p className="text-xs uppercase tracking-wide text-warn">outgoing · unresolved</p>
                <p className="mt-1 text-ink2">{entry.reason}</p>
                <Field label="coin_id" value={entry.coinIdHex} mono />
              </div>
            );
          }
          return (
            <div
              key={`out-${i}`}
              data-testid="history-outgoing"
              className="rounded border border-line bg-surface p-3 text-sm"
            >
              <p className="text-xs uppercase tracking-wide text-ink3">outgoing · recovered</p>
              <Field label="coin_id" value={entry.coinIdHex} mono />
              <Field label="amount" value={entry.coin.amount} />
            </div>
          );
        })}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Verification checklist (§5.8)</h3>
        <CheckList checks={view.checks} />
      </section>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-0.5">
      <span className="text-ink3">{label}</span>
      <span className={mono === true ? 'break-all font-mono text-xs text-ink' : 'text-ink'}>
        {value}
      </span>
    </div>
  );
}

function EmptyFragment({ title, grammar }: { title: string; grammar: string }) {
  return (
    <div
      data-testid="fragment-empty"
      className="space-y-2 rounded border border-line bg-surface p-4"
    >
      <h2 className="text-base font-medium">{title}</h2>
      <p className="text-sm text-ink2">
        No fragment present. Bearer secrets must be supplied in the URL fragment only — never as a
        query string.
      </p>
      <p className="font-mono text-xs text-ink3">{grammar}</p>
    </div>
  );
}
