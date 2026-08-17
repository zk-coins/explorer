/**
 * `snap` is the only function specs use to take a screenshot.
 *
 * Defaults differ from the wallet app: fullPage is true (simple content pages,
 * not long scrolling wallet screens). No default mask set — every upstream
 * value in this suite comes from a fixed fixture.
 */

import { expect, type Locator, type Page } from '@playwright/test';

export interface SnapOptions {
  mask?: Locator[];
  fullPage?: boolean;
  /** Pixel-level diff tolerance override. Defaults to the project value. */
  maxDiffPixelRatio?: number;
  clip?: { x: number; y: number; width: number; height: number };
}

/**
 * Take a screenshot and compare against the baseline.
 *
 * Always waits for `domcontentloaded` and web fonts before capturing.
 */
export async function snap(page: Page, name: string, opts: SnapOptions = {}): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => document.fonts?.ready);
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: opts.fullPage !== undefined ? opts.fullPage : true,
    ...(opts.mask !== undefined ? { mask: opts.mask } : {}),
    ...(opts.maxDiffPixelRatio !== undefined ? { maxDiffPixelRatio: opts.maxDiffPixelRatio } : {}),
    ...(opts.clip !== undefined ? { clip: opts.clip } : {}),
  });
}

/** Standard viewport presets used across the suite. */
export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 375, height: 812 },
} as const;

export async function setViewport(
  page: Page,
  vp: keyof typeof VIEWPORTS = 'desktop',
): Promise<void> {
  await page.setViewportSize(VIEWPORTS[vp]);
}
