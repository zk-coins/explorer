'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const PUBLIC_LINKS = [
  { href: '/', label: 'Inscriptions' },
  { href: '/accumulator/', label: 'Accumulator' },
  { href: '/nullifier/', label: 'Nullifier lookup' },
] as const;

const BEARER_LINKS = [
  { href: '/tx/', label: 'Tx link' },
  { href: '/balance/', label: 'Balance link' },
  { href: '/addr/', label: 'Addr link' },
] as const;

function linkClass(active: boolean): string {
  return [
    'rounded px-2 py-1 text-sm transition-colors',
    active ? 'bg-line2 text-ink' : 'text-ink2 hover:text-ink',
  ].join(' ');
}

/**
 * Navigation makes the §5.5 two-layer boundary visible:
 * Public (L1-anchor) vs Authorised/bearer account layer.
 */
export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-3 text-sm" aria-label="Explorer modes">
      <div>
        <p className="mb-1 text-[10px] uppercase tracking-widest text-bitcoin">
          Public · L1 anchor
        </p>
        <ul className="flex flex-wrap gap-1">
          {PUBLIC_LINKS.map((l) => {
            const active =
              l.href === '/'
                ? pathname === '/' || pathname === ''
                : pathname === l.href || pathname === l.href.replace(/\/$/, '');
            return (
              <li key={l.href}>
                <Link href={l.href} className={linkClass(active)}>
                  {l.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      <div>
        <p className="mb-1 text-[10px] uppercase tracking-widest text-ink3">
          Authorised / bearer · account layer
        </p>
        <ul className="flex flex-wrap gap-1">
          {BEARER_LINKS.map((l) => {
            const active = pathname === l.href || pathname === l.href.replace(/\/$/, '');
            return (
              <li key={l.href}>
                <Link href={l.href} className={linkClass(active)}>
                  {l.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
