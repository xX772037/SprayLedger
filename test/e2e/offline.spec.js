import { test, expect } from '@playwright/test';

// The other browser tests block the service worker; this one needs it.
test.use({ serviceWorkers: 'allow' });

test('after one visit, the app opens with no network and shows all the steps', async ({ page, context }) => {
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
  // the six record steps, plus the Invoice step after them
  await expect(tabs).toHaveCount(7);
  for (const name of ['Field', 'Plan', 'Spray', 'Products', 'Details', 'Documents', 'Invoice']) await expect(tabs.filter({ hasText: name })).toHaveCount(1);
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

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../../', import.meta.url);
const listFiles = dir => readdirSync(new URL(`${dir}/`, ROOT), { withFileTypes: true })
  .flatMap(d => d.isDirectory() ? listFiles(`${dir}/${d.name}`) : [`${dir}/${d.name}`]);

test('the offline store really holds the page, styles, every src/*.js and every vendor file', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  const cached = await page.evaluate(async () => {
    const out = [];
    for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) out.push(new URL(req.url).pathname.slice(1));
    return out;
  });
  const want = ['index.html', 'styles.css', ...listFiles('src'), ...listFiles('vendor').filter(f => !/LICENSE$/.test(f))];
  const missing = want.filter(f => !cached.includes(f));
  expect(missing).toEqual([]);
});

test('offline: draw a field and load a log, and the coverage shows on the plain background', async ({ page, context }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#offlineBadge')).toBeVisible();

  // A new job: draw the field's corners on the map with no satellite picture.
  await page.getByRole('button', { name: 'New job', exact: true }).click();
  await expect(page.locator('#tileNote')).toContainText('No internet');
  // Zoom in on where the log will be, using the map's own coordinate search (no network needed).
  await page.locator('#gotoInput').fill('43.3014, -97.9');
  await page.locator('#gotoInput').press('Enter');
  await page.locator('#btnDraw').click();
  const box = await page.locator('#map').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  for (const [dx, dy] of [[-120, -110], [120, -110], [120, 110], [-120, 110]]) await page.mouse.click(cx + dx, cy + dy);
  await page.locator('#drawDone').click();
  await expect(page.locator('#drawBar')).toBeHidden();

  // Load a log on the Spray step: coverage is worked out and drawn without the network.
  await page.locator('.steps [data-step="spray"]').click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#paneLog label.file-btn').click();
  await (await chooser).setFiles(fileURLToPath(new URL('./fixtures/control-log.csv', import.meta.url)));
  await expect(page.locator('#stats')).toContainText('Acres sprayed');
  await expect(page.locator('#stats')).toContainText(/\d%\s*of [\d.]+ acres/); // coverage of the drawn field
  await expect(page.locator('.coverage-overlay')).toHaveCount(1);
  expect(errors).toEqual([]);
  await context.setOffline(false);
});
