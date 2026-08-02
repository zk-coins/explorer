'use client';

import { useEffect, useState } from 'react';
import { ErrorState } from '@/components/ErrorState';
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

  useEffect(() => {
    // Client-only: fragment is never available to the static export server.
    // Do not move this parse into a server component or pass the hash via query.
    const hash = readLocationHash();
    if (kind === 'tx') {
      setTx(parseTxFragment(hash));
    } else if (kind === 'balance') {
      setBalance(parseBalanceFragment(hash));
    } else {
      setAddr(parseAddrFragment(hash));
    }
  }, [kind]);

  if (kind === 'tx') {
    return <TxBody result={tx} />;
  }
  if (kind === 'balance') {
    return <BalanceBody result={balance} />;
  }
  return <AddrBody result={addr} />;
}

function TxBody({ result }: { result: TxFragmentResult | null }) {
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
  return (
    <NotYetImplemented
      title="Transaction disclosure"
      detail={`Parsed zkbid (${result.bundle.length} B) and zkview (${result.view.length} B). Decryption and Bitcoin verification are not implemented in this block.`}
    />
  );
}

function BalanceBody({ result }: { result: BalanceFragmentResult | null }) {
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
  return (
    <NotYetImplemented
      title="Balance attestation"
      detail={`Parsed address, asset_id, and attestation form "${result.attestationForm}". Verification is not implemented in this block.`}
    />
  );
}

function AddrBody({ result }: { result: AddrFragmentResult | null }) {
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
  return (
    <NotYetImplemented
      title="Account view"
      detail={`Parsed address and zkavk (${result.avkByteLength} B). History decrypt is not implemented in this block.`}
    />
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

function NotYetImplemented({ title, detail }: { title: string; detail: string }) {
  return (
    <div
      data-testid="not-yet-implemented"
      className="space-y-2 rounded border border-line bg-surface p-4"
    >
      <h2 className="text-base font-medium">{title}</h2>
      <p className="text-sm text-bitcoin">Not yet implemented</p>
      <p className="text-sm text-ink2">{detail}</p>
      <p className="text-xs text-ink3">
        Authorised / bearer decryption and verification is the next implementation block. A
        successful fragment parse is not a disclosure success.
      </p>
    </div>
  );
}
