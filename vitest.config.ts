import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@/': path.resolve(__dirname, './src/') + '/',
    },
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Required by src/lib/config.ts — no silent default host in production either.
    env: {
      NEXT_PUBLIC_NODE_BASE_URL: 'https://test-node.example.invalid',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/__tests__/**',
        // Next.js App Router route wiring: each file is a one-line
        // `export default function X() { return <Component/>; }` re-export
        // with zero branching logic (see src/app/*/page.tsx, src/app/page.tsx).
        // layout.tsx additionally wires next/font/google, which requires the
        // full Next.js build pipeline and cannot be meaningfully unit-tested
        // under vitest/happy-dom without mocking the entire Next.js runtime
        // for zero logic coverage gain. All of src/app/** is exercised
        // end-to-end by the Playwright suite under e2e/.
        'src/app/**',
      ],
      // Every executable coverage axis is pinned at 100%. Structurally
      // unreachable library invariants are documented with narrow v8 ignores
      // at the exact branch rather than weakening the project-wide threshold.
      thresholds: {
        statements: 100,
        functions: 100,
        lines: 100,
        branches: 100,
      },
    },
  },
});
