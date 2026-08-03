/**
 * Spec 07 — Flagship contrast: authorised vs unauthorised confirmation link.
 *
 * Both tests live under Visual Regression so chromium owns the goldens;
 * functional asserts ride along with the snaps.
 *
 * Unauthorised path: same ciphertext/blob_id, wrong zkview → zbe_open fails
 * AEAD. TxBody still mounts confirmation-view with ErrorState on top and a
 * populated check list (fatalError does not strip checks).
 */

import { expect, test } from '@playwright/test';
import { mockPublicApi } from './_helpers/network';
import { snap, setViewport } from './_helpers/screenshot';
import { blossomBytesFromHex, readBearerLinks } from './_helpers/fixtures';

test.describe('Visual Regression — 07 bearer authorised vs unauthorised', () => {
  test('07-tx-authorised', async ({ page }) => {
    const { txAuthorised } = readBearerLinks();
    await setViewport(page, 'desktop');
    await mockPublicApi(page, {
      blossom: blossomBytesFromHex(txAuthorised.blossomFixtures),
      nullifiers: txAuthorised.nullifierFixtures,
    });
    await page.goto(`/tx/${txAuthorised.fragment}`);
    await expect(page.getByTestId('confirmation-view')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('coin-fields')).toBeVisible();
    await expect(page.getByTestId('check-blob_id')).toHaveAttribute('data-status', 'pass');
    await expect(page.getByTestId('check-zbe_open')).toHaveAttribute('data-status', 'pass');
    await expect(page.getByTestId('check-coinproof_decode')).toHaveAttribute('data-status', 'pass');
    await snap(page, '07-tx-authorised');
  });

  test('07-tx-unauthorised', async ({ page }) => {
    const { txUnauthorised } = readBearerLinks();
    await setViewport(page, 'desktop');
    await mockPublicApi(page, {
      blossom: blossomBytesFromHex(txUnauthorised.blossomFixtures),
      nullifiers: txUnauthorised.nullifierFixtures,
    });
    await page.goto(`/tx/${txUnauthorised.fragment}`);
    // confirmation-view wraps both ErrorState and the check list when open fails.
    await expect(page.getByTestId('confirmation-view')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('error-state')).toBeVisible();
    await expect(page.getByTestId('error-state')).toContainText(/auth|ZBE|Poly1305|failed/i);
    await expect(page.getByTestId('check-zbe_open')).toHaveAttribute('data-status', 'fail');
    await snap(page, '07-tx-unauthorised');
  });
});
