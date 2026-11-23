// Shared helpers for the browser tests.

/**
 * Keep tests independent of outside services: map pictures, weather and county parcel data are
 * blocked, so every run sees the same app (the app shows its "can't load" notices instead).
 */
export async function blockOutsideServices(page) {
  await page.route(url => !['localhost', '127.0.0.1'].includes(url.hostname), route => route.abort());
}

/** The number shown in a coverage tile, e.g. "Acres sprayed" → 0.5. */
export async function tileValue(page, label) {
  const exact = new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`); // "Gallons", not "Gallons per acre"
  const tile = page.locator('#stats .stat', { has: page.locator('.k', { hasText: exact }) });
  const text = (await tile.locator('.v').innerText()).replace(/,/g, '');
  return parseFloat(text);
}
