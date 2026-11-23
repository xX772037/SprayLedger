import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { blockOutsideServices, tileValue } from './helpers.js';

const LOG = fileURLToPath(new URL('./fixtures/spray-rate-log.csv', import.meta.url));

test('a flight log whose flow column is named spray_rate gives coverage and gallons', async ({ page }) => {
  await blockOutsideServices(page);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');

  // Start a blank job so only this log counts.
  await page.getByRole('button', { name: 'New job', exact: true }).click();
  await expect(page.locator('#jobTitle')).toHaveText('New job');
  await page.locator('.steps').getByRole('tab', { name: /Spray/ }).click();

  const chooser = page.waitForEvent('filechooser');
  await page.locator('#paneLog label.file-btn').click();
  await (await chooser).setFiles(LOG);
  await expect(page.locator('#files')).toContainText('spray-rate-log.csv');

  // The spray_rate column must count as flow (and as spraying), not be mistaken for an on/off switch.
  await expect(page.locator('#stats .stat')).toHaveCount(4);
  expect(await tileValue(page, 'Acres sprayed')).toBeGreaterThan(0);
  expect(await tileValue(page, 'Gallons')).toBeGreaterThan(0);
  await expect(page.locator('#notices')).not.toContainText('No spraying found');
  expect(errors).toEqual([]);
});

const CONTROL = fileURLToPath(new URL('./fixtures/control-log.csv', import.meta.url));

/** Import one log into a fresh job and read the Acres sprayed and Gallons tiles. */
async function importAndRead(page, file) {
  await page.getByRole('button', { name: 'New job', exact: true }).click();
  await page.locator('.steps').getByRole('tab', { name: /Spray/ }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#paneLog label.file-btn').click();
  await (await chooser).setFiles(file);
  await expect(page.locator('#stats .stat')).toHaveCount(4);
  return { acres: await tileValue(page, 'Acres sprayed'), gallons: await tileValue(page, 'Gallons') };
}

test('the spray_rate log and a control log of the same flight (standard flow and spraying columns) give the same acres and gallons', async ({ page }) => {
  await blockOutsideServices(page);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  const a = await importAndRead(page, LOG);
  const b = await importAndRead(page, CONTROL);
  expect(a.acres).toBeGreaterThan(0); expect(a.gallons).toBeGreaterThan(0);
  expect(a).toEqual(b); // the tiles round to 0.1 acre and 0.1 gal
  expect(errors).toEqual([]);
});

test('saving right after a swath change stores the new acres, not the old ones', async ({ page }) => {
  await blockOutsideServices(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'New job', exact: true }).click();
  await page.locator('.steps').getByRole('tab', { name: /Spray/ }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#paneLog label.file-btn').click();
  await (await chooser).setFiles(CONTROL);
  await expect(page.locator('#stats .stat')).toHaveCount(4);
  const before = await tileValue(page, 'Acres sprayed');
  // A wider swath, then Save at once (within the 300 ms the recalculation waits).
  await page.locator('#swath').fill('30');
  await page.locator('#btnSave').evaluate(b => b.click()); // Save is on step 5; clicking it directly avoids any wait
  const stored = await page.evaluate(() => new Promise(res => {
    const q = indexedDB.open('sprayledger');
    q.onsuccess = () => { const g = q.result.transaction('records').objectStore('records').getAll(); g.onsuccess = () => res(g.result[0]); };
  }));
  expect(Number(stored.equipment.swathFt)).toBe(30);
  expect(stored.summary.acresTreated).toBeGreaterThan(before * 1.2); // 30 ft / 23 ft ≈ 1.3
});
