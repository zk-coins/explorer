/**
 * Small shell/nav/badge/checklist components — direct render coverage.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { usePathname } from 'next/navigation';
import { CheckList } from '@/components/CheckList';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { Nav } from '@/components/Nav';
import { Shell } from '@/components/Shell';
import { StateBadge } from '@/components/StateBadge';
import { fail, open, pass } from '@/lib/bearer/checks';
import type { NullifierState } from '@/lib/api/types';

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/'),
}));

describe('StateBadge', () => {
  it('renders known states', () => {
    render(<StateBadge state="completed" />);
    expect(screen.getByTestId('state-completed').textContent).toBe('completed');
  });

  it('throws on unknown state', () => {
    expect(() => render(<StateBadge state={'bogus' as NullifierState} />)).toThrow(/unknown state/);
  });
});

describe('CheckList', () => {
  it('renders pass / fail / open items', () => {
    render(
      <CheckList
        checks={[
          pass('p1', 'Pass label', 'ok detail'),
          fail('f1', 'Fail label', 'bad detail'),
          open('o1', 'Open label', 'pending detail'),
        ]}
      />,
    );
    expect(screen.getByTestId('check-list')).toBeTruthy();
    expect(screen.getByTestId('check-p1').getAttribute('data-status')).toBe('pass');
    expect(screen.getByTestId('check-f1').getAttribute('data-status')).toBe('fail');
    expect(screen.getByTestId('check-o1').getAttribute('data-status')).toBe('open');
    expect(screen.getByTestId('check-p1').textContent).toMatch(/Pass label/);
    expect(screen.getByTestId('check-f1').textContent).toMatch(/bad detail/);
  });
});

describe('Nav + Shell', () => {
  it('renders Shell with children and Nav links', () => {
    vi.mocked(usePathname).mockReturnValue('/');
    render(
      <Shell>
        <p data-testid="child">hello</p>
      </Shell>,
    );
    expect(screen.getByTestId('child').textContent).toBe('hello');
    expect(screen.getByText('Inscriptions')).toBeTruthy();
    expect(screen.getByText('Tx link')).toBeTruthy();
  });

  it('marks public root active and bearer inactive on /', () => {
    vi.mocked(usePathname).mockReturnValue('/');
    render(<Nav />);
    const inscriptions = screen.getByText('Inscriptions');
    expect(inscriptions.className).toMatch(/bg-line2/);
    const tx = screen.getByText('Tx link');
    expect(tx.className).not.toMatch(/bg-line2/);
  });

  it('marks accumulator active via trailing-slash-stripped match', () => {
    vi.mocked(usePathname).mockReturnValue('/accumulator');
    render(<Nav />);
    const acc = screen.getByText('Accumulator');
    expect(acc.className).toMatch(/bg-line2/);
  });

  it('marks bearer link active for exact href with trailing slash', () => {
    vi.mocked(usePathname).mockReturnValue('/tx/');
    render(<Nav />);
    const tx = screen.getByText('Tx link');
    expect(tx.className).toMatch(/bg-line2/);
  });

  it('marks bearer link active without trailing slash', () => {
    vi.mocked(usePathname).mockReturnValue('/balance');
    render(<Nav />);
    const bal = screen.getByText('Balance link');
    expect(bal.className).toMatch(/bg-line2/);
  });

  it('treats empty pathname as root for inscriptions', () => {
    vi.mocked(usePathname).mockReturnValue('');
    render(<Nav />);
    expect(screen.getByText('Inscriptions').className).toMatch(/bg-line2/);
  });
});

describe('ErrorState + LoadingState', () => {
  it('renders error and loading labels', () => {
    render(
      <>
        <ErrorState title="Boom" message="detail" />
        <LoadingState label="Working…" />
      </>,
    );
    expect(screen.getByTestId('error-state').textContent).toMatch(/Boom/);
    expect(screen.getByTestId('error-state').textContent).toMatch(/detail/);
    expect(screen.getByTestId('loading-state').textContent).toBe('Working…');
  });
});
