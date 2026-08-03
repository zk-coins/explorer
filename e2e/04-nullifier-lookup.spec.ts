/**
 * Spec 04 — Nullifier lookup (`/nullifier/`).
 */

import { expect, test } from '@playwright/test';
import { mockPublicApi } from './_helpers/network';
import { snap, setViewport } from './_helpers/screenshot';
import {
  FIXTURE_NULLIFIER_ABSENT_RAW,
  FIXTURE_NULLIFIER_PRESENT_RAW,
} from './_fixtures/publicChain';

const PRESENT_PK = '11'.repeat(32);
const ABSENT_PK = 'ab'.repeat(32);

test.describe('04 nullifier lookup — functional', () => {
  test('present true shows position', async ({ page }) => {
    await setViewport(page, 'desktop');
    await mockPublicApi(page, {
      nullifiers: {
        [PRESENT_PK]: FIXTURE_NULLIFIER_PRESENT_RAW,
      },
    });
    await page.goto('/nullifier/');
    await page.getByTestId('nullifier-input').fill(PRESENT_PK);
    await page.getByTestId('nullifier-submit').click();
    await expect(page.getByTestId('nullifier-result')).toBeVisible();
    await expect(page.getByTestId('nullifier-present')).toHaveText('true');
    await expect(page.getByTestId('nullifier-position')).toBeVisible();
  });

  test('present false', async ({ page }) => {
    await setViewport(page, 'desktop');
    await mockPublicApi(page, {
      nullifiers: {
        [ABSENT_PK]: FIXTURE_NULLIFIER_ABSENT_RAW,
      },
    });
    await page.goto('/nullifier/');
    await page.getByTestId('nullifier-input').fill(ABSENT_PK);
    await page.getByTestId('nullifier-submit').click();
    await expect(page.getByTestId('nullifier-result')).toBeVisible();
    await expect(page.getByTestId('nullifier-present')).toHaveText('false');
  });

  test('invalid input is client-side only', async ({ page }) => {
    await setViewport(page, 'desktop');
    await mockPublicApi(page);
    await page.goto('/nullifier/');
    await page.getByTestId('nullifier-input').fill('not-hex');
    await page.getByTestId('nullifier-submit').click();
    await expect(page.getByTestId('error-state')).toBeVisible();
    await expect(page.getByTestId('error-state')).toContainText('64 hex');
    await expect(page.getByTestId('nullifier-result')).toHaveCount(0);
  });
});

test.describe('Visual Regression — 04 nullifier lookup', () => {
  test('04-nullifier-present', async ({ page }) => {
    await setViewport(page, 'desktop');
    await mockPublicApi(page, {
      nullifiers: {
        [PRESENT_PK]: FIXTURE_NULLIFIER_PRESENT_RAW,
      },
    });
    await page.goto('/nullifier/');
    await page.getByTestId('nullifier-input').fill(PRESENT_PK);
    await page.getByTestId('nullifier-submit').click();
    await expect(page.getByTestId('nullifier-result')).toBeVisible();
    await expect(page.getByTestId('nullifier-present')).toHaveText('true');
    await expect(page.getByTestId('nullifier-position')).toBeVisible();
    await snap(page, '04-nullifier-present');
  });

  test('04-nullifier-absent', async ({ page }) => {
    await setViewport(page, 'desktop');
    await mockPublicApi(page, {
      nullifiers: {
        [ABSENT_PK]: FIXTURE_NULLIFIER_ABSENT_RAW,
      },
    });
    await page.goto('/nullifier/');
    await page.getByTestId('nullifier-input').fill(ABSENT_PK);
    await page.getByTestId('nullifier-submit').click();
    await expect(page.getByTestId('nullifier-result')).toBeVisible();
    await expect(page.getByTestId('nullifier-present')).toHaveText('false');
    await snap(page, '04-nullifier-absent');
  });

  test('04-nullifier-invalid-input', async ({ page }) => {
    await setViewport(page, 'desktop');
    await mockPublicApi(page);
    await page.goto('/nullifier/');
    await page.getByTestId('nullifier-input').fill('not-hex');
    await page.getByTestId('nullifier-submit').click();
    await expect(page.getByTestId('error-state')).toBeVisible();
    await snap(page, '04-nullifier-invalid-input');
  });
});
