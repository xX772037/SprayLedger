import { test, expect } from '@playwright/test';

// The other browser tests block the service worker; this one needs it.
test.use({ serviceWorkers: 'allow' });

test('after one visit, the app opens with no network and shows all six steps', async ({ page, context }) => {
  await page.goto('/');
  // Wait until the service worker has stored the app and controls the page.
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#offlineBadge')).toBeVisible();
  await expect(page.locator('#viewHome')).toBeVisible();
  await page.getByRole('button', { name: 'Try the practice job' }).click();
  const tabs = page.locator('.steps [data-step]');
  await expect(tabs).toHaveCount(6);
  for (const name of ['Field', 'Plan', 'Spray', 'Products', 'Details', 'Documents']) await expect(tabs.filter({ hasText: name })).toHaveCount(1);
  // The map still works on its plain background, and says why there is no picture.
  await page.locator('.steps [data-step="field"]').click();
  await expect(page.locator('#tileNote')).toContainText('No internet');

  // A job saved offline is marked "Not synced" in My jobs.
  await page.locator('#btnNew').click();
  await page.locator('.steps [data-step="finish"]').click();
  await page.locator('#f_field').fill('Offline 40');
  await page.locator('#btnSave').click();
  await page.locator('#btnJobs').click();
  await expect(page.locator('#recList li', { hasText: 'Offline 40' }).locator('.chip.offline')).toHaveText('Not synced');
  await expect(page.locator('#syncNote')).toBeVisible();
  await context.setOffline(false);
});
