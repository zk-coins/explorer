/**
 * Public mode cursor pagination honesty: subset counts + load-more surface.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { NodeApiError } from '@/lib/api/types';
import { FIXTURE_ACCUMULATOR, FIXTURE_INFO, FIXTURE_INSCRIPTIONS } from './fixtures/public-chain';

const fetchInfo = vi.fn();
const fetchAccumulator = vi.fn();
const fetchInscriptions = vi.fn();

vi.mock('@/lib/api/client', () => ({
  fetchInfo: (...args: unknown[]) => fetchInfo(...args),
  fetchAccumulator: (...args: unknown[]) => fetchAccumulator(...args),
  fetchInscriptions: (...args: unknown[]) => fetchInscriptions(...args),
}));

import { PublicHome } from '@/components/PublicHome';

describe('PublicHome pagination', () => {
  beforeEach(() => {
    fetchInfo.mockReset();
    fetchAccumulator.mockReset();
    fetchInscriptions.mockReset();
    fetchInfo.mockResolvedValue(FIXTURE_INFO);
    fetchAccumulator.mockResolvedValue(FIXTURE_ACCUMULATOR);
  });

  afterEach(() => {
    cleanup();
  });

  it('labels loaded subset and loads next cursor page', async () => {
    const page1 = {
      ...FIXTURE_INSCRIPTIONS,
      next_height: 200n,
      next_tx_index: 0,
      next_vin_index: 0,
    };
    const page2 = {
      inscriptions: [
        {
          txid: 'ee'.repeat(32),
          height: 200n,
          tx_index: 0,
          vin_index: 0,
          count: 1,
          format: 1,
          confirmation_state: 'completed' as const,
          nullifiers: [
            {
              pubkey: '99'.repeat(32),
              r: '88'.repeat(32),
              state: 'completed' as const,
            },
          ],
        },
      ],
    };
    fetchInscriptions.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);

    render(<PublicHome />);

    await waitFor(() => {
      expect(screen.getByTestId('inscription-list')).toBeTruthy();
    });
    expect(screen.getByTestId('pagination-note').textContent).toMatch(/subset|more available/i);
    expect(screen.getAllByTestId('inscription-card')).toHaveLength(2);
    expect(screen.getByTestId('load-more-inscriptions')).toBeTruthy();

    fireEvent.click(screen.getByTestId('load-more-inscriptions'));
    await waitFor(() => {
      expect(screen.getAllByTestId('inscription-card')).toHaveLength(3);
    });
    // Cursor exhausted — no more button, note without "more available".
    expect(screen.queryByTestId('load-more-inscriptions')).toBeNull();
    expect(screen.getByTestId('pagination-note').textContent).toMatch(/loaded set/);
  });

  it('loadMore surfaces NodeApiError without wiping existing data', async () => {
    fetchInscriptions
      .mockResolvedValueOnce({
        ...FIXTURE_INSCRIPTIONS,
        next_height: 200n,
        next_tx_index: 0,
        next_vin_index: 0,
      })
      .mockRejectedValueOnce(new NodeApiError(500, 'http_error', 'page 2 failed'));

    render(<PublicHome />);
    await waitFor(() => {
      expect(screen.getByTestId('load-more-inscriptions')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('load-more-inscriptions'));
    await waitFor(() => {
      expect(screen.getByTestId('error-state').textContent).toMatch(/http_error.*page 2 failed/);
    });
    expect(screen.getByTestId('inscription-list')).toBeTruthy();
  });

  it('loadMore surfaces generic Error and non-Error', async () => {
    fetchInscriptions
      .mockResolvedValueOnce({
        ...FIXTURE_INSCRIPTIONS,
        next_height: 1n,
        next_tx_index: 0,
        next_vin_index: 0,
      })
      .mockRejectedValueOnce(new Error('more boom'));

    render(<PublicHome />);
    await waitFor(() => screen.getByTestId('load-more-inscriptions'));
    fireEvent.click(screen.getByTestId('load-more-inscriptions'));
    await waitFor(() => {
      expect(screen.getByTestId('error-state').textContent).toMatch(/more boom/);
    });

    cleanup();
    fetchInscriptions
      .mockResolvedValueOnce({
        ...FIXTURE_INSCRIPTIONS,
        next_height: 1n,
        next_tx_index: 0,
        next_vin_index: 0,
      })
      .mockRejectedValueOnce('more-string');
    render(<PublicHome />);
    await waitFor(() => screen.getByTestId('load-more-inscriptions'));
    fireEvent.click(screen.getByTestId('load-more-inscriptions'));
    await waitFor(() => {
      expect(screen.getByTestId('error-state').textContent).toMatch(/more-string/);
    });
  });

  it('loadInitial NodeApiError / Error / non-Error paths', async () => {
    fetchInscriptions.mockRejectedValue(new NodeApiError(503, 'down', 'unavailable'));
    render(<PublicHome />);
    await waitFor(() => {
      expect(screen.getByTestId('error-state').textContent).toMatch(/down.*unavailable/);
    });

    cleanup();
    fetchInscriptions.mockRejectedValue(new Error('init fail'));
    render(<PublicHome />);
    await waitFor(() => {
      expect(screen.getByTestId('error-state').textContent).toMatch(/init fail/);
    });

    cleanup();
    fetchInscriptions.mockRejectedValue(99);
    render(<PublicHome />);
    await waitFor(() => {
      expect(screen.getByTestId('error-state').textContent).toMatch(/99/);
    });
  });

  it('aborts initial load on unmount', async () => {
    let resolveIns: (v: unknown) => void = () => {};
    fetchInscriptions.mockImplementation(
      () =>
        new Promise((r) => {
          resolveIns = r;
        }),
    );
    const { unmount } = render(<PublicHome />);
    expect(screen.getByTestId('loading-state')).toBeTruthy();
    unmount();
    resolveIns(FIXTURE_INSCRIPTIONS);
    await Promise.resolve();
  });

  it('aborts loadInitial catch path on unmount when pending fetch rejects', async () => {
    let rejectIns: (reason?: unknown) => void = () => {};
    fetchInscriptions.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectIns = reject;
        }),
    );
    const { unmount } = render(<PublicHome />);
    expect(screen.getByTestId('loading-state')).toBeTruthy();
    unmount();
    rejectIns(new Error('late failure'));
    // must not throw, must not update state after unmount
    await Promise.resolve();
  });

  it('React suppresses concurrent clicks while loadingMore disables the button', async () => {
    const page1 = {
      ...FIXTURE_INSCRIPTIONS,
      next_height: 200n,
      next_tx_index: 0,
      next_vin_index: 0,
    };
    let resolvePage2: (v: unknown) => void = () => {};
    fetchInscriptions.mockResolvedValueOnce(page1).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePage2 = resolve;
        }),
    );

    render(<PublicHome />);
    await waitFor(() => {
      expect(screen.getByTestId('load-more-inscriptions')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('load-more-inscriptions'));
    await waitFor(() => {
      expect(screen.getByTestId('load-more-inscriptions')).toBeDisabled();
    });
    // React's delegated event layer consults the current disabled prop and does
    // not deliver this second click to loadMore.
    const btn = screen.getByTestId('load-more-inscriptions');
    fireEvent.click(btn);

    // Initial page + one page-2 fetch only (the disabled click had no listener).
    expect(fetchInscriptions).toHaveBeenCalledTimes(2);

    resolvePage2({
      inscriptions: [
        {
          txid: 'ee'.repeat(32),
          height: 200n,
          tx_index: 0,
          vin_index: 0,
          count: 1,
          format: 1,
          confirmation_state: 'completed' as const,
          nullifiers: [
            {
              pubkey: '99'.repeat(32),
              r: '88'.repeat(32),
              state: 'completed' as const,
            },
          ],
        },
      ],
    });
    await waitFor(() => {
      expect(screen.getAllByTestId('inscription-card')).toHaveLength(3);
    });
  });

  it('loadMore returns early once cursor is exhausted (no further fetch)', async () => {
    const page1 = {
      ...FIXTURE_INSCRIPTIONS,
      next_height: 200n,
      next_tx_index: 0,
      next_vin_index: 0,
    };
    // No cursor fields -> next cursor is null after this page settles.
    const lastPage = { inscriptions: [] };
    let resolveLast: (v: unknown) => void = () => {};
    fetchInscriptions.mockResolvedValueOnce(page1).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLast = resolve;
        }),
    );

    render(<PublicHome />);
    await waitFor(() => {
      expect(screen.getByTestId('load-more-inscriptions')).toBeTruthy();
    });

    const btn = screen.getByTestId('load-more-inscriptions');
    fireEvent.click(btn);
    await waitFor(() => {
      expect(btn).toBeDisabled();
    });

    // Resolve the load-more fetch to a null cursor while still holding the
    // button reference. Once React commits, hasMore is false and the button
    // unmounts — so a third fetch cannot be started through the UI.
    resolveLast(lastPage);
    await waitFor(() => {
      expect(screen.queryByTestId('load-more-inscriptions')).toBeNull();
    });
    expect(fetchInscriptions).toHaveBeenCalledTimes(2);

    // Best-effort re-invoke on the captured (now-detached) node. React 17+
    // root delegation means this typically does not reach the handler either;
    // the outer proof is that cursor exhaustion never produces a third fetch.
    btn.removeAttribute('disabled');
    fireEvent.click(btn);
    btn.click();
    await Promise.resolve();
    expect(fetchInscriptions).toHaveBeenCalledTimes(2);
  });

  it('treats either missing trailing cursor field as cursor exhaustion', async () => {
    const partials = [
      { inscriptions: [], next_height: 201n },
      { inscriptions: [], next_height: 201n, next_tx_index: 0 },
    ];
    for (const partial of partials) {
      cleanup();
      fetchInscriptions.mockReset();
      fetchInscriptions
        .mockResolvedValueOnce({
          ...FIXTURE_INSCRIPTIONS,
          next_height: 200n,
          next_tx_index: 0,
          next_vin_index: 0,
        })
        .mockResolvedValueOnce(partial);
      render(<PublicHome />);
      await waitFor(() => expect(screen.getByTestId('load-more-inscriptions')).toBeTruthy());
      fireEvent.click(screen.getByTestId('load-more-inscriptions'));
      await waitFor(() => expect(screen.queryByTestId('load-more-inscriptions')).toBeNull());
      expect(fetchInscriptions).toHaveBeenCalledTimes(2);
    }
  });

  it('retains load-more when all three next-cursor fields are present', async () => {
    fetchInscriptions
      .mockResolvedValueOnce({
        ...FIXTURE_INSCRIPTIONS,
        next_height: 200n,
        next_tx_index: 0,
        next_vin_index: 0,
      })
      .mockResolvedValueOnce({
        inscriptions: [],
        next_height: 201n,
        next_tx_index: 2,
        next_vin_index: 3,
      })
      .mockResolvedValueOnce({ inscriptions: [] });
    render(<PublicHome />);
    await waitFor(() => expect(screen.getByTestId('load-more-inscriptions')).toBeTruthy());
    fireEvent.click(screen.getByTestId('load-more-inscriptions'));
    await waitFor(() => expect(fetchInscriptions).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('load-more-inscriptions')).toBeTruthy();
    fireEvent.click(screen.getByTestId('load-more-inscriptions'));
    await waitFor(() => expect(fetchInscriptions).toHaveBeenCalledTimes(3));
    expect(fetchInscriptions.mock.calls[2]?.[0]).toMatchObject({
      from_height: 201n,
      from_tx_index: 2,
      from_vin_index: 3,
    });
  });
});
