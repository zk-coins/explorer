// Test-only: config.ts requires NEXT_PUBLIC_NODE_BASE_URL (no production default).
// Production builds enforce the same variable in next.config.js.
if (
  typeof process.env.NEXT_PUBLIC_NODE_BASE_URL !== 'string' ||
  process.env.NEXT_PUBLIC_NODE_BASE_URL.length === 0
) {
  process.env.NEXT_PUBLIC_NODE_BASE_URL = 'https://test-node.example.invalid';
}

import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
