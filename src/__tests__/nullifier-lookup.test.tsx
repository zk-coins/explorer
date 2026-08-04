/**
 * NullifierLookupPanel — Path-B UI paths (module-mocked fetchNullifier).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { NodeApiError } from '@/lib/api/types';
import { FIXTURE_NULLIFIER_ABSENT, FIXTURE_NULLIFIER_PRESENT } from './fixtures/public-chain';

const fetchNullifier = vi.fn();

vi.mock('@/lib/api/client', () => ({
  fetchNullifier: (...args: unknown[]) => fetchNullifier(...args),
}));

import { NullifierLookupPanel } from '@/components/NullifierLookup';

describe('NullifierLookupPanel', () => {
  beforeEach(() => {
    fetchNullifier.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('rejects invalid hex64 without calling fetch', async () => {
    render(<NullifierLookupPanel />);
    fireEvent.change(screen.getByTestId('nullifier-input'), { target: { value: 'deadbeef' } });
    fireEvent.click(screen.getByTestId('nullifier-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('error-state').textContent).toMatch(/64 hex/);
    });
    expect(fetchNullifier).not.toHaveBeenCalled();
  });

  it('shows present:true result with position and audit path', async () => {
    fetchNullifier.mockResolvedValue(FIXTURE_NULLIFIER_PRESENT);
    render(<NullifierLookupPanel />);
    fireEvent.change(screen.getByTestId('nullifier-input'), {
      target: { value: 'AA'.repeat(32) },
    });
    fireEvent.click(screen.getByTestId('nullifier-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('nullifier-result')).toBeTruthy();
    });
    expect(screen.getByTestId('nullifier-present').textContent).toBe('true');
    expect(screen.getByTestId('nullifier-position').textContent).toBe('0');
    expect(fetchNullifier).toHaveBeenCalledWith('aa'.repeat(32));
  });

  it('shows present:false informational paragraph without position', async () => {
    fetchNullifier.mockResolvedValue(FIXTURE_NULLIFIER_ABSENT);
    render(<NullifierLookupPanel />);
    fireEvent.change(screen.getByTestId('nullifier-input'), {
      target: { value: 'bb'.repeat(32) },
    });
    fireEvent.click(screen.getByTestId('nullifier-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('nullifier-result')).toBeTruthy();
    });
    expect(screen.getByTestId('nullifier-present').textContent).toBe('false');
    expect(screen.queryByTestId('nullifier-position')).toBeNull();
    expect(screen.getByTestId('nullifier-result').textContent).toMatch(/unauthenticated/);
  });

  it('surfaces NodeApiError as code: message', async () => {
    fetchNullifier.mockRejectedValue(new NodeApiError(404, 'not_found', 'pk unknown'));
    render(<NullifierLookupPanel />);
    fireEvent.change(screen.getByTestId('nullifier-input'), {
      target: { value: 'cc'.repeat(32) },
    });
    fireEvent.click(screen.getByTestId('nullifier-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('error-state').textContent).toMatch(/not_found.*pk unknown/);
    });
  });

  it('surfaces generic Error and non-Error throws', async () => {
    fetchNullifier.mockRejectedValueOnce(new Error('net fail'));
    render(<NullifierLookupPanel />);
    fireEvent.change(screen.getByTestId('nullifier-input'), {
      target: { value: 'dd'.repeat(32) },
    });
    fireEvent.click(screen.getByTestId('nullifier-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('error-state').textContent).toMatch(/net fail/);
    });

    cleanup();
    fetchNullifier.mockRejectedValueOnce(42);
    render(<NullifierLookupPanel />);
    fireEvent.change(screen.getByTestId('nullifier-input'), {
      target: { value: 'ee'.repeat(32) },
    });
    fireEvent.click(screen.getByTestId('nullifier-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('error-state').textContent).toMatch(/42/);
    });
  });

  it('shows loading state while the lookup promise is pending', async () => {
    let resolve: (v: unknown) => void = () => {};
    fetchNullifier.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    render(<NullifierLookupPanel />);
    fireEvent.change(screen.getByTestId('nullifier-input'), {
      target: { value: 'ff'.repeat(32) },
    });
    fireEvent.click(screen.getByTestId('nullifier-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('loading-state')).toBeTruthy();
    });
    resolve(FIXTURE_NULLIFIER_PRESENT);
    await waitFor(() => {
      expect(screen.getByTestId('nullifier-result')).toBeTruthy();
    });
  });
});
