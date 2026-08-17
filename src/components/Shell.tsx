import type { ReactNode } from 'react';
import { Nav } from '@/components/Nav';

/**
 * App chrome. Two layers are always visible in the nav (§5.5):
 * L1-anchor (Public mode) vs account/bearer (Authorised routes).
 */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-ink3">zkCoins</p>
            <h1 className="text-lg font-semibold text-ink">Explorer</h1>
            <p className="mt-1 max-w-xl text-sm text-ink2">
              Stateless presentation of the public L1-anchor layer. No keys, no wallet, no private
              amounts.
            </p>
          </div>
          <Nav />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
      <footer className="border-t border-line">
        <div className="mx-auto max-w-5xl px-4 py-4 text-xs text-ink3">
          Self-hostable · reads a node&apos;s public §7.5 endpoints · never a trusted authority
        </div>
      </footer>
    </div>
  );
}
