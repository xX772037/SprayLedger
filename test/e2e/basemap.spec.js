import { test, expect } from '@playwright/test';

// A stand-in map picture, so the test needs no internet and every tile "loads".
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGM4IScnl2cDAAc3Ac047clTAAAAAElFTkSuQmCC', 'base64');

test('the map opens on Hybrid: satellite pictures with roads and place names on top; Satellite and Streets still switch', async ({ page }) => {
  const asked = [];
  await page.route(u => !['localhost', '127.0.0.1'].includes(u.hostname), route => {
    const url = route.request().url();
    if (/arcgisonline\.com|tile\.openstreetmap\.org/.test(url)) { asked.push(url); return route.fulfill({ status: 200, contentType: 'image/png', body: PNG }); }
    return route.abort();
  });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the practice job' }).click();
  await page.locator('.steps [data-step="field"]').click();

  const ctl = page.locator('.basemap-ctl');
  await expect(ctl.getByRole('button', { name: 'Hybrid' })).toHaveAttribute('aria-pressed', 'true');
  const kinds = () => ({
    imagery: asked.some(u => u.includes('World_Imagery')),
    roads: asked.some(u => u.includes('Reference/World_Transportation')),
    places: asked.some(u => u.includes('Reference/World_Boundaries_and_Places')),
    streets: asked.some(u => u.includes('tile.openstreetmap.org')),
  });
  await expect.poll(kinds).toEqual({ imagery: true, roads: true, places: true, streets: false });
  await expect(page.locator('#tileNote')).toBeHidden();
  await expect(page.locator('.leaflet-control-attribution')).toContainText('roads and places');

  // Satellite: pictures only, no road or place layers on the map.
  await ctl.getByRole('button', { name: 'Satellite' }).click();
  await expect(ctl.getByRole('button', { name: 'Satellite' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.locator('.leaflet-tile-pane img[src*="Reference/"]').count()).toBe(0);
  await expect.poll(() => page.locator('.leaflet-tile-pane img[src*="World_Imagery"]').count()).toBeGreaterThan(0);

  // Streets, then back to Hybrid: the overlays come back.
  await ctl.getByRole('button', { name: 'Streets' }).click();
  await expect.poll(kinds).toMatchObject({ streets: true });
  await ctl.getByRole('button', { name: 'Hybrid' }).click();
  await expect.poll(() => page.locator('.leaflet-tile-pane img[src*="Reference/World_Transportation"]').count()).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
