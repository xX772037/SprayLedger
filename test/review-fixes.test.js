// Tests for the fixes from the November 2026 independent review.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFlightCSV, parseFile, detectColumns, parseTime } from '../src/parse.js';
import { computeCoverage } from '../src/coverage.js';
import { makeProjection } from '../src/geo.js';
import { emptyRecord, reentryTime, missingRei, complianceCheck, isAdjuvant } from '../src/records.js';
import { parseAddress, classifyParcels, neighbourZone, normalizeFeature, PARCEL_SOURCES } from '../src/parcels.js';
import { PRODUCTS } from '../src/catalog.js';
import { packPoints, unpackPoints } from '../src/store.js';

// ---- Blocker 1: a "spray_rate" / "pump_flow" column is the flow rate, not also the on/off switch
test('a spray_rate or pump_flow column is read as flow, and spraying comes from it', () => {
  for (const col of ['spray_rate', 'pump_flow', 'Spray Rate (L/min)']) {
    const c = detectColumns(['time', 'lat', 'lon', col]);
    assert.equal(c.flow, 3, col); assert.equal(c.spray, -1, col);
    const r = parseFlightCSV(`time,lat,lon,${col}\n2026-06-14T10:00:00Z,43.3,-97.9,4.5\n2026-06-14T10:00:01Z,43.30001,-97.9,4.5\n`);
    assert.ok(r.points.every(p => p.spray), `${col}: flow > 0 means spraying`);
    assert.equal(r.points[0].flowLpm, 4.5);
  }
  // a real spray column next to a flow column keeps both
  const both = detectColumns(['time', 'lat', 'lon', 'spray_rate', 'spray_on']);
  assert.deepEqual([both.flow, both.spray], [3, 4]);
});

test('a log with no spraying at all says so', () => {
  const r = parseFlightCSV('time,lat,lon,spraying\n0,43.3,-97.9,0\n1,43.30001,-97.9,0\n');
  assert.match(r.warnings.join(' '), /No spraying found/);
});

// ---- Blocker 2: unknown REI blocks the re-entry time instead of vanishing
function rec(products) {
  const r = emptyRecord();
  r.job = { ...r.job, date: '2026-06-14', start: '06:42', end: '08:33', farm: 'F', customerAddress: 'A', pest: 'P', crop: 'C' };
  r.products = products.map(p => ({ ...r.products[0], rate: '1', ...p }));
  return r;
}
test('an unknown REI makes the re-entry time unknown, and the record check flags it', () => {
  const r = rec([{ name: 'A', rei: '4' }, { name: 'B', rei: '' }]);
  assert.equal(reentryTime(r), null);
  assert.deepEqual(missingRei(r).map(p => p.name), ['B']);
  assert.ok(complianceCheck(r).missing.some(m => m.ref === 'REI'));
  r.products[1].rei = '12';
  assert.equal(reentryTime(r).getHours(), 20); // 08:33 + 12 h
});
test('REIs confirmed on the labels are in the product list', () => {
  for (const name of ['Liberty ULTRA', 'Trivapro', 'Miravis Neo', 'Mustang Maxx', 'Hero']) assert.equal(PRODUCTS.find(p => p.name === name).rei, 12, name);
  assert.equal(PRODUCTS.find(p => p.name === 'Delaro Complete').rei, null, 'only a secondary source: left for the label');
});

// ---- Record rules
test('adjuvants are not held to the pesticide label items', () => {
  const r = rec([{ name: 'Veltyma', common: 'x', company: 'BASF', ai: '1.67 lb', rei: '12' }, { name: 'Non-ionic surfactant (NIS)', common: 'non-ionic surfactant', kind: 'adjuvant' }]);
  r.applicator = { ...r.applicator, name: 'N', cert: 'AP-1' }; r.conditions = { wind: '5', windDir: 'SW', temp: '70' };
  r.summary = { acresTreated: 40, volumeGal: 80, lat: 43.3, lon: -97.9 };
  assert.ok(isAdjuvant(r.products[1]));
  assert.ok(isAdjuvant({ name: 'Crop oil concentrate', common: '', epa: '' }), 'recognised by name when typed');
  assert.equal(complianceCheck(r).complete, true, JSON.stringify(complianceCheck(r).missing));
});
test('a job that runs past midnight: re-entry counts from the next day', () => {
  const r = rec([{ name: 'A', rei: '12' }]);
  r.job.start = '23:00'; r.job.end = '01:00';
  const re = reentryTime(r);
  assert.equal(re.getDate(), 15); assert.equal(re.getHours(), 13);
});
test('the record check still has the 11 state items (the current rule has no 12th)', () => {
  const ids = complianceCheck(rec([{ name: 'A', rei: '4' }])).items.map(i => i.ref).filter(x => /^\d+$/.test(x));
  assert.deepEqual(ids, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']);
});

// ---- Times
test('clock times without a time zone are flagged so local/UTC can be chosen', () => {
  assert.equal(parseTime('2026-06-14 06:42:00').naive, true);
  assert.equal(parseTime('2026-06-14T06:42:00Z').naive, false);
  assert.equal(parseTime('2026-06-14T06:42:00-05:00').naive, false);
  assert.equal(parseFlightCSV('time,lat,lon,spraying\n2026-06-14 06:42:00,43.3,-97.9,1\n').meta.naiveTime, true);
});
test('KML and GeoJSON tracks without times or spray data say so instead of guessing', () => {
  const kml = '<kml><Placemark><LineString><coordinates>-97.9,43.3 -97.899,43.3</coordinates></LineString></Placemark></kml>';
  const k = parseFile('t.kml', kml);
  assert.equal(k.meta.timeless, true);
  assert.match(k.warnings.join(' '), /no flow data/); assert.match(k.warnings.join(' '), /no times/); assert.match(k.warnings.join(' '), /whole path/);
  const g = parseFile('t.geojson', JSON.stringify({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[-97.9, 43.3], [-97.899, 43.3]] } }));
  assert.equal(g.meta.timeless, true);
  assert.match(g.warnings.join(' '), /no flow data/, 'GeoJSON now warns like KML');
});

// ---- Coverage gaps are reported, not silently dropped
test('stretches left out of the coverage for a gap or a GPS jump are counted', () => {
  const proj = makeProjection(43.3, -97.9);
  const pts = [[0, 0, 0], [5, 0, 1], [10, 0, 2], [15, 0, 40], [20, 0, 41], [400, 0, 42]].map(([x, y, s]) => { const [lat, lon] = proj.toLatLon(x, y); return { t: s * 1000, lat, lon, spray: true, flowLpm: 5, flight: '1' }; });
  const d = computeCoverage({ points: pts, swathM: 6 }).stats.dropped;
  assert.equal(d.gaps, 1); assert.equal(d.jumps, 1);
});

// ---- Parcels
test('"County Road 5" and "Highway 37" are read as roads, not as "COUNTY"', () => {
  assert.deepEqual(parseAddress('27500 County Road 5'), { num: '27500', street: '5' });
  assert.deepEqual(parseAddress('41000 Hwy 37'), { num: '41000', street: '37' });
  assert.deepEqual(parseAddress('41255 277th St'), { num: '41255', street: '277' });
});
test('a parcel mostly inside the field counts as the field even when its centre is outside; same-name owners at different addresses stay apart', () => {
  const src = PARCEL_SOURCES.find(s => s.county === 'Hutchinson');
  const feat = (owner, mail, ring) => normalizeFeature({ type: 'Feature', properties: { OWNERNAME: owner, PARCEL_NUM: owner + mail, MAILING_ADDRESS: mail }, geometry: { type: 'Polygon', coordinates: [ring] } }, src);
  const field = [[[[43.300, -97.705], [43.300, -97.695], [43.310, -97.695], [43.310, -97.705]]]];
  // An L-shaped parcel: most of it inside the field, but the vertex average of its outline falls outside.
  const L = feat('L OWNER', 'A', [[-97.705, 43.300], [-97.6955, 43.300], [-97.6955, 43.309], [-97.680, 43.309], [-97.680, 43.310], [-97.705, 43.310], [-97.705, 43.300]].map(([lo, la]) => [lo, la]));
  const zone = neighbourZone(field, null, 400);
  const c = classifyParcels([L, feat('SMITH JOHN', '1 Main', [[-97.694, 43.300], [-97.690, 43.300], [-97.690, 43.305], [-97.694, 43.305], [-97.694, 43.300]]),
    feat('SMITH JOHN', '9 Elm', [[-97.694, 43.305], [-97.690, 43.305], [-97.690, 43.309], [-97.694, 43.309], [-97.694, 43.305]])], zone);
  assert.deepEqual(c.field.map(p => p.owner), ['L OWNER']);
  assert.equal(c.neighbours.length, 2, 'two different John Smiths');
});

// ---- Store
test('saved flight points survive a pack and unpack', () => {
  const pts = [{ t: 1, lat: 43.1234567, lon: -97.7654321, flowLpm: 4.5, spray: true, flight: '1' }, { t: 2, lat: 43.2, lon: -97.8, flowLpm: NaN, spray: false, flight: '2' }];
  const back = unpackPoints(JSON.parse(JSON.stringify(packPoints(pts))));
  assert.deepEqual(back.map(p => [p.t, p.lat, p.lon, p.spray, p.flight]), pts.map(p => [p.t, p.lat, p.lon, p.spray, p.flight]));
  assert.ok(Number.isNaN(back[1].flowLpm));
});
