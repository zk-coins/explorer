/**
 * AccumulatorPageClient effect/fetch error paths (module-mocked client).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { NodeApiError } from '@/lib/api/types';
import { FIXTURE_ACCUMULATOR, FIXTURE_INFO } from './fixtures/public-chain';

const fetchInfo = vi.fn();
const fetchAccumulator = vi.fn();

vi.mock('@/lib/api/client', () => ({
  fetchInfo: (...args: unknown[]) => fetchInfo(...args),
  fetchAccumulator: (...args: unknown[]) => fetchAccumulator(...args),
}));

import { AccumulatorPageClient } from '@/components/AccumulatorPageClient';

describe('AccumulatorPageClient', () => {
  beforeEach(() => {
    fetchInfo.mockReset();
    fetchAccumulator.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders accumulator on success', async () => {
    fetchInfo.mockResolvedValue(FIXTURE_INFO);
    fetchAccumulator.mockResolvedValue(FIXTURE_ACCUMULATOR);

    render(<AccumulatorPageClient />);

    await waitFor(() => {
      expect(screen.getByTestId('accumulator-view')).toBeTruthy();
    });
  });

  it('surfaces NodeApiError as code: message', async () => {
    fetchInfo.mockRejectedValue(new NodeApiError(503, 'dependency_unavailable', 'scanner down'));
    fetchAccumulator.mockResolvedValue(FIXTURE_ACCUMULATOR);

    render(<AccumulatorPageClient />);

    await waitFor(() => {
      expect(screen.getByTestId('error-state')).toBeTruthy();
    });
    expect(screen.getByTestId('error-state').textContent).toMatch(
      /dependency_unavailable.*scanner down/,
    );
  });

  it('surfaces generic Error message', async () => {
    fetchInfo.mockRejectedValue(new Error('boom'));
    fetchAccumulator.mockResolvedValue(FIXTURE_ACCUMULATOR);

    render(<AccumulatorPageClient />);

    await waitFor(() => {
      expect(screen.getByTestId('error-state').textContent).toMatch(/boom/);
    });
  });

  it('surfaces non-Error throw via String(err)', async () => {
    fetchInfo.mockRejectedValue('string-fail');
    fetchAccumulator.mockResolvedValue(FIXTURE_ACCUMULATOR);

    render(<AccumulatorPageClient />);

    await waitFor(() => {
      expect(screen.getByTestId('error-state').textContent).toMatch(/string-fail/);
    });
  });

  it('aborts in-flight load on unmount without crashing', async () => {
    let resolveInfo: (v: unknown) => void = () => {};
    fetchInfo.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInfo = resolve;
        }),
    );
    fetchAccumulator.mockImplementation(() => new Promise(() => {}));

    const { unmount } = render(<AccumulatorPageClient />);
    expect(screen.getByTestId('loading-state')).toBeTruthy();
    unmount();
    resolveInfo(FIXTURE_INFO);
    // No state update after unmount — must not throw.
    await Promise.resolve();
  });

  it('aborts catch path on unmount when pending fetch rejects', async () => {
    let rejectInfo: (reason?: unknown) => void = () => {};
    fetchInfo.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectInfo = reject;
        }),
    );
    fetchAccumulator.mockImplementation(() => new Promise(() => {}));

    const { unmount } = render(<AccumulatorPageClient />);
    expect(screen.getByTestId('loading-state')).toBeTruthy();
    unmount();
    rejectInfo(new Error('late failure'));
    // must not throw, must not update state after unmount
    await Promise.resolve();
  });
});
