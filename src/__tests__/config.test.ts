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

  it('throws when URL contains userinfo', async () => {
    process.env.NEXT_PUBLIC_NODE_BASE_URL = 'https://user:pass@node.example.invalid';
    vi.resetModules();
    await expect(import('@/lib/config')).rejects.toThrow(/userinfo/);
  });

  it('throws when URL contains a query string', async () => {
    process.env.NEXT_PUBLIC_NODE_BASE_URL = 'https://node.example.invalid?x=1';
    vi.resetModules();
    await expect(import('@/lib/config')).rejects.toThrow(/query/);
  });

  it('throws when URL contains a fragment', async () => {
    process.env.NEXT_PUBLIC_NODE_BASE_URL = 'https://node.example.invalid#frag';
    vi.resetModules();
    await expect(import('@/lib/config')).rejects.toThrow(/fragment/);
  });

  it('throws when hostname is empty', async () => {
    // WHATWG rejects a special-scheme URL with an empty host as Invalid URL
    // (`https:///` throws; `https:///nohost` is host `nohost`).
    process.env.NEXT_PUBLIC_NODE_BASE_URL = 'https:///';
    vi.resetModules();
    await expect(import('@/lib/config')).rejects.toThrow(
      /not a valid absolute URL|hostname must be non-empty/,
    );
  });

  it('exports stripped base URL when valid', async () => {
    process.env.NEXT_PUBLIC_NODE_BASE_URL = 'https://node.example.invalid///';
    vi.resetModules();
    const mod = await import('@/lib/config');
    expect(mod.NODE_BASE_URL).toBe('https://node.example.invalid');
  });
});
