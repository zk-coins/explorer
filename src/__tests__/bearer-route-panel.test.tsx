/**
 * BearerRoutePanel — fragment shell + Tx/Balance/Addr body paths.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import { encodeBech32m, EXPLORER_HRPS } from '@/lib/bech32m';
import { base64UrlEncodeNoPad } from '@/lib/crypto/bytes';
import { fill } from './fixtures/crypto';

const resolveConfirmationLink = vi.fn();
const resolveBalanceAttestation = vi.fn();
const resolveAddressView = vi.fn();

vi.mock('@/lib/bearer/confirmation', () => ({
  resolveConfirmationLink: (...args: unknown[]) => resolveConfirmationLink(...args),
}));
vi.mock('@/lib/bearer/balance', () => ({
  resolveBalanceAttestation: (...args: unknown[]) => resolveBalanceAttestation(...args),
}));
vi.mock('@/lib/bearer/addressView', () => ({
  resolveAddressView: (...args: unknown[]) => resolveAddressView(...args),
}));

import { BearerRoutePanel } from '@/components/BearerRoutePanel';

function p(n: number, v: number): Uint8Array {
  return Uint8Array.from({ length: n }, () => v);
}

/**
 * Set location.hash via history.replaceState, then wait out happy-dom's
 * asynchronous native hashchange dispatch (confirmed: happy-dom fires
 * `hashchange` some tens of milliseconds after ANY hash-affecting call,
 * including replaceState, deviating from real-browser behavior). Callers
 * must await this BEFORE render() mounts BearerRoutePanel's hashchange
 * listener — otherwise that listener catches the spurious event and
 * causes an extra, unwanted re-parse + re-mount of the body component,
 * orphaning whichever promise a test has already captured a resolver for.
 */
async function setHash(hash: string): Promise<void> {
  const normalized = hash.startsWith('#') ? hash : hash.length > 0 ? `#${hash}` : '';
  history.replaceState(null, '', normalized.length > 0 ? normalized : window.location.pathname);
  await new Promise((r) => setTimeout(r, 50));
}

describe('BearerRoutePanel', () => {
  beforeEach(async () => {
    resolveConfirmationLink.mockReset();
    resolveBalanceAttestation.mockReset();
    resolveAddressView.mockReset();
    await setHash('');
  });

  afterEach(async () => {
    cleanup();
    await setHash('');
  });

  it('tx: empty fragment shows EmptyFragment', async () => {
    await setHash('');
    render(<BearerRoutePanel kind="tx" />);
    await waitFor(() => {
      expect(screen.getByTestId('fragment-empty')).toBeTruthy();
    });
    expect(screen.getByTestId('fragment-empty').textContent).toMatch(/Confirmation link/);
  });

  it('tx: invalid fragment shows ErrorState', async () => {
    await setHash('#not-valid');
    render(<BearerRoutePanel kind="tx" />);
    await waitFor(() => {
      expect(screen.getByTestId('error-state')).toBeTruthy();
    });
    expect(screen.getByTestId('error-state').textContent).toMatch(/Invalid confirmation/);
  });

  it('tx: valid fragment loading then success with optional fields', async () => {
    const bundle = encodeBech32m(EXPLORER_HRPS.zkbid, p(32, 1));
    const viewKey = encodeBech32m(EXPLORER_HRPS.zkview, p(32, 2));
    await setHash(`#${bundle}/${viewKey}`);

    let resolve!: (v: unknown) => void;
    resolveConfirmationLink.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );

    render(<BearerRoutePanel kind="tx" />);
    await waitFor(() => {
      expect(screen.getByText(/Decrypting confirmation/)).toBeTruthy();
    });

    await act(async () => {
      resolve({
        checks: [{ id: 'blob_id', label: 'blob', status: 'pass', detail: 'ok' }],
        state: 'completed',
        coin: {
          amount: '100',
          assetIdHex: 'aa'.repeat(32),
          recipientHex: 'bb'.repeat(32),
          identifierHex: 'cc'.repeat(32),
        },
        assetTermsName: 'USD',
        creatingNullifier: {
          pkCreateHex: '11'.repeat(32),
          rCreateHex: '22'.repeat(32),
          rPrimeCreateHex: '33'.repeat(32),
        },
        anchoring: {
          revealTxid: 'dd'.repeat(32),
          height: 10n,
          confirmations: 5n,
          tipHeight: 14n,
        },
        navOpening: { size: '3', mthHex: 'ee'.repeat(32) },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('confirmation-view')).toBeTruthy();
    });
    expect(screen.getByTestId('coin-fields').textContent).toMatch(/USD/);
    expect(screen.getByTestId('anchoring-trail').textContent).toMatch(/reveal txid/);
    expect(screen.getByTestId('check-list')).toBeTruthy();
  });

  it('tx: resolve rejects with Error and non-Error', async () => {
    const bundle = encodeBech32m(EXPLORER_HRPS.zkbid, p(32, 1));
    const viewKey = encodeBech32m(EXPLORER_HRPS.zkview, p(32, 2));
    await setHash(`#${bundle}/${viewKey}`);
    resolveConfirmationLink.mockRejectedValue(new Error('resolve boom'));
    render(<BearerRoutePanel kind="tx" />);
    await waitFor(() => {
      expect(screen.getByTestId('confirmation-view')).toBeTruthy();
    });
    expect(screen.getByTestId('error-state').textContent).toMatch(/resolve boom/);

    cleanup();
    await setHash(`#${bundle}/${viewKey}`);
    resolveConfirmationLink.mockRejectedValue(99);
    render(<BearerRoutePanel kind="tx" />);
    await waitFor(() => {
      expect(screen.getByTestId('error-state').textContent).toMatch(/99/);
    });
  });

  it('tx: unmount before resolve settles does not throw', async () => {
    const bundle = encodeBech32m(EXPLORER_HRPS.zkbid, p(32, 1));
    const viewKey = encodeBech32m(EXPLORER_HRPS.zkview, p(32, 2));
    await setHash(`#${bundle}/${viewKey}`);
    let resolve!: (v: unknown) => void;
    resolveConfirmationLink.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const { unmount } = render(<BearerRoutePanel kind="tx" />);
    await waitFor(() => {
      expect(screen.getByText(/Decrypting confirmation/)).toBeTruthy();
    });
    unmount();
    await act(async () => {
      resolve({ checks: [] });
    });
  });

  it('tx: hashchange re-parses', async () => {
    await setHash('');
    resolveConfirmationLink.mockResolvedValue({ checks: [] });
    render(<BearerRoutePanel kind="tx" />);
    await waitFor(() => {
      expect(screen.getByTestId('fragment-empty')).toBeTruthy();
    });
    const bundle = encodeBech32m(EXPLORER_HRPS.zkbid, p(32, 1));
    const viewKey = encodeBech32m(EXPLORER_HRPS.zkview, p(32, 2));
    await act(async () => {
      await setHash(`#${bundle}/${viewKey}`);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('confirmation-view')).toBeTruthy();
    });
  });

  it('balance: empty, invalid, loading, success, reject', async () => {
    await setHash('');
    render(<BearerRoutePanel kind="balance" />);
    await waitFor(() => {
      expect(screen.getByTestId('fragment-empty').textContent).toMatch(/Balance attestation/);
    });

    cleanup();
    await setHash('#bad');
    render(<BearerRoutePanel kind="balance" />);
    await waitFor(() => {
      expect(screen.getByTestId('error-state').textContent).toMatch(/Invalid balance/);
    });

    cleanup();
    const address = encodeBech32m(EXPLORER_HRPS.zk, p(32, 5));
    const assetId = 'ab'.repeat(32);
    const inline = base64UrlEncodeNoPad(fill(32, 9));
    await setHash(`#${address}/${assetId}/i:${inline}`);
    let resolve!: (v: unknown) => void;
    resolveBalanceAttestation.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    render(<BearerRoutePanel kind="balance" />);
    await waitFor(() => {
      expect(screen.getByText(/Verifying balance attestation/)).toBeTruthy();
    });
    await act(async () => {
      resolve({
        checks: [{ id: 'decode', label: 'd', status: 'pass', detail: 'ok' }],
        fields: {
          subjectHex: '11'.repeat(32),
          assetIdHex: assetId,
          balance: '9000',
          navCeilingHex: '22'.repeat(32),
          sizeCeiling: '1',
          txidHex: '33'.repeat(32),
          blockHashHex: '44'.repeat(32),
          height: '1',
          pkAnchorHex: '55'.repeat(32),
          rAnchorHex: '66'.repeat(32),
          networkIdHex: '77'.repeat(32),
          proofLen: 10,
        },
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId('balance-attestation-view')).toBeTruthy();
    });
    expect(screen.getByTestId('attestation-fields').textContent).toMatch(/9000/);

    cleanup();
    await setHash(`#${address}/${assetId}/i:${inline}`);
    resolveBalanceAttestation.mockRejectedValue(new Error('bal fail'));
    render(<BearerRoutePanel kind="balance" />);
    await waitFor(() => {
      expect(screen.getByTestId('error-state').textContent).toMatch(/bal fail/);
    });
  });

  it('addr: empty, invalid, loading, full history variants, reject', async () => {
    await setHash('');
    render(<BearerRoutePanel kind="addr" />);
    await waitFor(() => {
      expect(screen.getByTestId('fragment-empty').textContent).toMatch(/Account view/);
    });

    cleanup();
    await setHash('#bad');
    render(<BearerRoutePanel kind="addr" />);
    await waitFor(() => {
      expect(screen.getByTestId('error-state').textContent).toMatch(/Invalid account/);
    });

    cleanup();
    const address = encodeBech32m(EXPLORER_HRPS.zk, p(32, 3));
    const avk = encodeBech32m(EXPLORER_HRPS.zkavk, p(64, 4));
    await setHash(`#${address}/${avk}`);
    let resolve!: (v: unknown) => void;
    resolveAddressView.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    render(<BearerRoutePanel kind="addr" />);
    await waitFor(() => {
      expect(screen.getByText(/Opening account view/)).toBeTruthy();
    });
    await act(async () => {
      resolve({
        mode: 'full',
        addressHex: 'aa'.repeat(32),
        checks: [{ id: 'avk_mode', label: 'm', status: 'pass', detail: 'ok' }],
        historyNotResolvable: true,
        history: [
          {
            side: 'incoming',
            coin: {
              amount: '1',
              assetIdHex: 'bb'.repeat(32),
              recipientHex: 'cc'.repeat(32),
              identifierHex: 'dd'.repeat(32),
            },
            epkHex: '11'.repeat(32),
            detectTagHex: '22'.repeat(32),
            creatingPkHex: '33'.repeat(32),
          },
          {
            side: 'outgoing',
            status: 'not_derivable',
            reason: 'ivk only',
          },
          {
            side: 'outgoing',
            status: 'unresolved',
            reason: 'no ktx',
            coinIdHex: '44'.repeat(32),
            blobIdHex: '55'.repeat(32),
            epkHex: '66'.repeat(32),
          },
          {
            side: 'outgoing',
            status: 'recovered',
            coin: {
              amount: '2',
              assetIdHex: 'bb'.repeat(32),
              recipientHex: 'cc'.repeat(32),
              identifierHex: 'dd'.repeat(32),
            },
            coinIdHex: '77'.repeat(32),
            blobIdHex: '88'.repeat(32),
            epkHex: '99'.repeat(32),
          },
        ],
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId('address-view')).toBeTruthy();
    });
    expect(screen.getByTestId('avk-mode').textContent).toMatch(/full/);
    expect(screen.getByTestId('history-not-resolvable')).toBeTruthy();
    expect(screen.getByTestId('history-incoming')).toBeTruthy();
    expect(screen.getByTestId('history-outgoing-not-derivable')).toBeTruthy();
    expect(screen.getByTestId('history-outgoing-unresolved')).toBeTruthy();
    expect(screen.getByTestId('history-outgoing')).toBeTruthy();

    cleanup();
    // incoming-only mode empty history without historyNotResolvable.
    const avk32 = encodeBech32m(EXPLORER_HRPS.zkavk, p(32, 4));
    await setHash(`#${address}/${avk32}`);
    resolveAddressView.mockResolvedValue({
      mode: 'incoming_only',
      addressHex: 'aa'.repeat(32),
      checks: [],
      history: [],
    });
    render(<BearerRoutePanel kind="addr" />);
    await waitFor(() => {
      expect(screen.getByTestId('address-view')).toBeTruthy();
    });
    expect(screen.getByTestId('avk-mode').textContent).toMatch(/incoming-only/);
    expect(screen.getByTestId('history-list').textContent).toMatch(/No discovered entries/);

    cleanup();
    await setHash(`#${address}/${avk}`);
    resolveAddressView.mockRejectedValue(new Error('addr fail'));
    render(<BearerRoutePanel kind="addr" />);
    await waitFor(() => {
      expect(screen.getByTestId('error-state').textContent).toMatch(/addr fail/);
    });
  });
});
