// Jobs saved by earlier versions of the app must keep opening. These two records were saved by the real
// earlier versions (the first release, IndexedDB v1; and the version before invoicing, IndexedDB v2) in a
// browser, then copied here unchanged. They have none of the newer fields: no invoice, no product charges,
// no payment instructions, and (in the first release) no equipment type or working speed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { normalizeRecord, complianceCheck, invoiceTotals, fmtMoney, recordsToCSV, productTotals, reentryTime, acresTreated } from '../src/records.js';
import { unpackPoints } from '../src/store.js';
import { computeCoverage } from '../src/coverage.js';
import { isGround } from '../src/equipment.js';

globalThis.window = globalThis.window || globalThis;
vm.runInThisContext(`(function (self) { ${readFileSync(new URL('../vendor/jspdf/jspdf.umd.min.js', import.meta.url), 'utf8')} }).call(globalThis, globalThis);`);
window.jspdf = globalThis.jspdf;
const { customerReport, stateRecord, invoicePdf } = await import('../src/docs.js');

const FIXTURES = ['saved-by-v1-first-release', 'saved-by-v2-before-invoicing'];
const load = name => JSON.parse(readFileSync(new URL(`./fixtures/records/${name}.json`, import.meta.url), 'utf8'));

for (const name of FIXTURES) {
  test(`${name}: opens with the newer fields filled in as blanks, and nothing it had is lost`, () => {
    const raw = load(name);
    assert.equal(raw.invoice, undefined, 'fixture really is from before invoicing');
    const r = normalizeRecord(structuredClone(raw));
    assert.deepEqual(r.invoice, { number: '', ratePerAcre: '', total: 0 });
    assert.equal(r.applicator.payment, '');
    assert.equal(r.job.field, raw.job.field);
    assert.equal(r.products[0].name, 'Roundup PowerMAX 3');
    assert.equal(r.products[0].rate, '32');
    assert.equal(r.products[0].invoiceCost, '');
    assert.equal(typeof isGround(r.equipment), 'boolean');
  });

  test(`${name}: its saved flight log still unpacks and gives the same coverage`, () => {
    const r = normalizeRecord(load(name));
    const pts = unpackPoints(r.log.points);
    assert.equal(pts.length, 70);
    const c = computeCoverage({ points: pts, boundary: r.log.boundary || [], swathM: Number(r.equipment.swathFt) * 0.3048 });
    const acres = c.stats.sprayedM2 / 4046.8564224;
    assert.ok(acres > 0 && c.stats.volumeL > 0);
    if (name === 'saved-by-v2-before-invoicing') {
      // This version saved stale acres when the job was saved within 300 ms of a swath change (23 ft -> 30 ft
      // when the T50 was picked): the stored summary still says 0.531. The app recalculates when a job opens,
      // and now also before every save, so the 30 ft acres are what's used.
      assert.ok(Math.abs(r.summary.acresTreated - 0.5310294647729383) < 1e-9, 'the fixture keeps the old stale value');
      assert.ok(Math.abs(acres - 0.6827521689937778) < 1e-6, `recalculated at 30 ft: ${acres}`);
    } else {
      assert.ok(Math.abs(acres - r.summary.acresTreated) < 1e-6, 'same acres as when it was saved');
    }
  });

  test(`${name}: record check, invoice, spreadsheet and all three PDFs work`, () => {
    const r = normalizeRecord(load(name));
    const c = complianceCheck(r);
    assert.ok(Array.isArray(c.items) && c.items.length >= 14);
    const inv = invoiceTotals(r);
    assert.equal(fmtMoney(inv.total), '$0.00');
    r.invoice.ratePerAcre = '10';
    assert.equal(invoiceTotals(r).application, Math.round(Math.round(acresTreated(r) * 100) / 100 * 10 * 100) / 100);
    assert.ok(productTotals(r.products[0], r));
    reentryTime(r); // must not throw
    const csv = recordsToCSV([r]).trim().split('\r\n');
    assert.equal(csv.length, 2);
    assert.ok(csv[0].endsWith('invoice_rate_per_acre,invoice_total,invoice_number'));
    for (const doc of [customerReport(r), stateRecord(r), invoicePdf(r)]) assert.match(doc.output(), /^%PDF-/);
  });
}
