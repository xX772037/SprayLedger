import { test, expect } from '@playwright/test';
import { blockOutsideServices } from './helpers.js';

const STEPS = [
  { key: 'field', tab: 'Field', title: 'Choose the field' },
  { key: 'weather', tab: 'Plan', title: 'Plan the job' },
  { key: 'spray', tab: 'Spray', title: 'Spray the field' },
  { key: 'products', tab: 'Products', title: 'What went in the tank' },
  { key: 'finish', tab: 'Details', title: 'Job details' },
  { key: 'docs', tab: 'Documents', title: 'Documents' },
];

test('the sample job walks through all six steps and ends with both PDF downloads', async ({ page }) => {
  await blockOutsideServices(page);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');

  // Open the sample (practice) job from My jobs.
  await page.getByRole('button', { name: /My jobs/ }).click();
  await expect(page.locator('#viewJobs')).toBeVisible();
  await page.getByRole('button', { name: 'Open the practice job' }).click();
  await expect(page.locator('#viewJob')).toBeVisible();
  await expect(page.locator('#jobTitle')).toContainText('North 40');

  for (const [i, s] of STEPS.entries()) {
    await page.locator('.steps').getByRole('tab', { name: new RegExp(s.tab) }).click();
    await expect(page.locator('#stepCount')).toHaveText(`Step ${i + 1} of 6`);
    await expect(page.locator('#stepTitle')).toHaveText(s.title);
    await expect(page.locator(`[data-panel="${s.key}"]`)).toBeVisible();
    for (const other of STEPS.filter(o => o.key !== s.key)) await expect(page.locator(`[data-panel="${other.key}"]`)).toBeHidden();
  }

  // Documents: both PDFs have a visible Download button, and each one produces a real PDF.
  const downloads = page.locator('[data-doc][data-act="save"]');
  await expect(downloads).toHaveCount(2);
  for (const kind of ['customer', 'state']) {
    const button = page.locator(`[data-doc="${kind}"][data-act="save"]`);
    await expect(button).toBeVisible();
    await expect(button).toHaveText('Download PDF');
    const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
    const stream = await download.createReadStream();
    const first = await new Promise(res => stream.once('data', res));
    expect(first.subarray(0, 5).toString()).toBe('%PDF-');
  }
  expect(errors).toEqual([]);
});

test('a product with unknown REI shows a warning on the Documents step instead of a time', async ({ page }) => {
  await blockOutsideServices(page);
  await page.goto('/');
  await page.getByRole('button', { name: /My jobs/ }).click();
  await page.getByRole('button', { name: 'Open the practice job' }).click();
  await page.locator('.steps').getByRole('tab', { name: /Products/ }).click();
  const rei = page.locator('[data-panel="products"] input[data-prod="rei"]').first();
  await rei.fill('');
  await page.locator('.steps').getByRole('tab', { name: /Documents/ }).click();
  await expect(page.locator('#intervals')).toContainText('Re-entry time unknown — check the label');
  await expect(page.locator('#checklist li.miss')).toContainText(['Re-entry hours for every pesticide']);
});
