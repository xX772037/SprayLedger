// The legal documents: build both PDFs in Node with the same jsPDF the app ships, and read their text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { emptyRecord } from '../src/records.js';

// Load the vendored jsPDF the way a browser does (a classic script that sets window.jspdf).
globalThis.window = globalThis.window || globalThis;
vm.runInThisContext(`(function (self) { ${readFileSync(new URL('../vendor/jspdf/jspdf.umd.min.js', import.meta.url), 'utf8')} }).call(globalThis, globalThis);`);
window.jspdf = globalThis.jspdf;
const { customerReport, stateRecord, fileName } = await import('../src/docs.js');

// jsPDF writes text uncompressed as (…) Tj; join every text run so phrases split across runs still match.
const textOf = doc => doc.output().match(/\((?:\\.|[^\\)])*\)\s*Tj/g).map(s => s.slice(1, s.lastIndexOf(')')).replace(/\\(.)/g, '$1')).join(' ');

function record() {
  const r = emptyRecord();
  r.id = 'abcdef1234567890';
  r.job = { ...r.job, date: '2026-06-14', start: '06:42', end: '08:33', farm: 'Test Farm', customerAddress: '1 Main St, Olivet SD', field: 'North 40', legal: 'NE1/4 6-98-58', crop: 'Soybeans', pest: 'Frogeye leaf spot', parcels: '098.58.06.1000', landowner: 'Test Owner' };
  r.applicator = { name: 'Pat Applicator', cert: 'AP-12345', company: 'Test Spraying', phone: '(605) 555-0100', address: 'Menno SD' };
  r.equipment = { ...r.equipment, drone: 'DJI Agras T50', swathFt: 30, targetGpa: 2 };
  r.products = [{ name: 'Veltyma', common: 'mefentrifluconazole + pyraclostrobin', company: 'BASF', epa: '7969-409', ai: '1.67 + 1.67 lb per gal', rate: '7', unit: 'fl oz', rei: '12', phi: '21', rup: false }];
  r.conditions = { wind: '6', windDir: 'SW', temp: '68', humidity: '60', source: 'Measured on site' };
  r.summary = { acresTreated: 39.4, fieldAcres: 40.7, volumeGal: 80, lat: 43.3, lon: -97.9, coveragePct: 96.9, skipAcres: 1.2, offTargetAcres: 0.1, hasBoundary: true };
  return r;
}

test('state record: every numbered section of the SD form, the rule, retention and signature', () => {
  const t = textOf(stateRecord(record()));
  for (const s of ['Pesticide Application Record', 'ARSD 12:56:07:01', 'three years',
    '(1) Person for whom the pesticide was applied', '(2) Location where the pesticide was applied', '(3) Pest(s) targeted', '(4) Size of area treated',
    '(5) Date and time', '(6) Applicator', '(7) Products', '(8) Company', '(9) Weather during application', '(10) Amount and concentration', '(11) Crop or site',
    'Test Farm', 'NE1/4 6-98-58', '7969-409', 'BASF', '1.67 + 1.67 lb per gal', 'AP-12345', 'SW', 'Applicator signature', 'keep until 2029-06-14']) {
    assert.ok(t.includes(s), `missing: ${s}`);
  }
  assert.ok(!t.includes('Not complete'), 'a complete record shows no missing-items box');
  // 7 fl oz/ac × 80 gal sprayed ÷ 2 gal/ac target = 280 fl oz = 2.188 gal
  assert.ok(t.includes('2.188 gal'), 'total pesticide in gallons');
});

test('state record lists what is missing when the record is incomplete', () => {
  const r = record(); r.job.pest = ''; r.applicator.cert = '';
  const t = textOf(stateRecord(r));
  assert.ok(t.includes('Not complete'));
  assert.ok(t.includes('Pest treated') && t.includes('Applicator license (AP) number'));
});

test('customer report: safety dates first, products, and an honest "see label" when the REI is unknown', () => {
  const t = textOf(customerReport(record()));
  for (const s of ['Spray Application Report', 'Keep people out until:', 'Do not harvest before:', 'Jul 5, 2026', 'Veltyma', 'Test Spraying']) assert.ok(t.includes(s), `missing: ${s}`);
  const r = record(); r.products[0].rei = '';
  const u = textOf(customerReport(r));
  assert.ok(u.includes('See the product labels'), 'unknown REI is not hidden');
});

test('PDF file names are safe', () => {
  const r = record(); r.job.field = 'North 40 / "east" field';
  assert.equal(fileName('customer-report', r), '2026-06-14-North-40-east-field-customer-report.pdf');
});
