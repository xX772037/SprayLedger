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

/**
 * The text of a PDF made by the app: inflate each compressed page stream and join its (...) Tj text runs.
 * Good enough to check what a document says; not a general PDF reader.
 */
export async function pdfText(buffer) {
  const { inflateSync } = await import('node:zlib');
  const bin = buffer.toString('latin1');
  let out = '';
  for (const m of bin.matchAll(/(?<!end)stream\r?\n/g)) {
    const start = m.index + m[0].length, end = bin.indexOf('endstream', start);
    if (end < 0) break;
    try { out += inflateSync(buffer.subarray(start, end)).toString('latin1') + '\n'; } catch { /* not compressed text */ }
  }
  return (out.match(/\((?:\\.|[^\\)])*\)\s*Tj/g) || []).map(s => s.slice(1, s.lastIndexOf(')')).replace(/\\(.)/g, '$1')).join(' ');
}
