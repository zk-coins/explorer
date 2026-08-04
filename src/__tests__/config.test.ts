/**
 * config.ts fail-closed NODE_BASE_URL — fresh module evaluation per case.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

describe('config.ts fail-closed NODE_BASE_URL', () => {
  const ORIGINAL = process.env.NEXT_PUBLIC_NODE_BASE_URL;

  afterEach(() => {
    process.env.NEXT_PUBLIC_NODE_BASE_URL = ORIGINAL;
    vi.resetModules();
  });

  it('throws when unset', async () => {
    delete process.env.NEXT_PUBLIC_NODE_BASE_URL;
    vi.resetModules();
    await expect(import('@/lib/config')).rejects.toThrow(/not set/);
  });

  it('throws when empty string', async () => {
    process.env.NEXT_PUBLIC_NODE_BASE_URL = '';
    vi.resetModules();
    await expect(import('@/lib/config')).rejects.toThrow(/not set/);
  });

  it('throws when missing http(s):// prefix', async () => {
    process.env.NEXT_PUBLIC_NODE_BASE_URL = 'ftp://bad.example';
    vi.resetModules();
    await expect(import('@/lib/config')).rejects.toThrow(/http/);
  });

  it('exports stripped base URL when valid', async () => {
    process.env.NEXT_PUBLIC_NODE_BASE_URL = 'https://node.example.invalid///';
    vi.resetModules();
    const mod = await import('@/lib/config');
    expect(mod.NODE_BASE_URL).toBe('https://node.example.invalid');
  });
});
