import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Shell } from '@/components/Shell';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#000000',
};

export const metadata: Metadata = {
  title: 'zkCoins Explorer',
  description:
    'Public L1-anchor explorer for zkCoins — AggregateStateNullifierV3 stream, nullifier accumulator, and bearer disclosure links.',
  // Defense-in-depth for §5.6 bearer fragments (static export cannot set HTTP headers).
  other: {
    referrer: 'no-referrer',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        {/*
          Spec §5.6: Referrer-Policy no-referrer as defense-in-depth.
          Primary secret protection is fragment transport (never sent to the server).
        */}
        <meta name="referrer" content="no-referrer" />
      </head>
      <body className="min-h-screen bg-bg font-sans text-ink antialiased" suppressHydrationWarning>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
