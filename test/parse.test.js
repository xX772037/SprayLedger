import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, parseFlightCSV, parseTime, parseGeoJSON, parseKML, parseFile } from '../src/parse.js';

test('parseCSV handles quotes, escaped quotes, CRLF and semicolons', () => {
  assert.deepEqual(parseCSV('a,b\r\n"x, y","say ""hi"""\r\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
  assert.deepEqual(parseCSV('a;b\n1;2'), [['a', 'b'], ['1', '2']]);
});

test('parseTime reads ISO, epoch seconds, epoch ms and elapsed seconds', () => {
  assert.equal(parseTime('2026-06-14T06:42:00Z').ms, Date.UTC(2026, 5, 14, 6, 42));
  assert.equal(parseTime('1781419320').ms, 1781419320000);
  assert.equal(parseTime('1781419320000').ms, 1781419320000);
  assert.deepEqual(parseTime('12.5'), { ms: 12500, relative: true });
  assert.equal(parseTime('nonsense'), null);
});

test('flight CSV: header synonyms, gal/min conversion, spray inferred from flow', () => {
  const csv = 'GPS Time,Lat,Lng,Flow (gal/min)\n2026-06-14 06:00:00,41.9,-93.5,1\n2026-06-14 06:00:01,41.90001,-93.5,0\n';
  const r = parseFlightCSV(csv);
  assert.equal(r.points.length, 2);
  assert.ok(Math.abs(r.points[0].flowLpm - 3.785411784) < 1e-9);
  assert.equal(r.points[0].spray, true);
  assert.equal(r.points[1].spray, false);
  assert.equal(r.points[0].flight, '1');
});

test('flight CSV: rows without a GPS fix are skipped with a warning; missing lat/lon is an error', () => {
  const r = parseFlightCSV('time,latitude,longitude,spraying\n0,0,0,1\n1,41.9,-93.5,1\n');
  assert.equal(r.points.length, 1);
  assert.match(r.warnings.join(' '), /without a GPS fix/);
  assert.throws(() => parseFlightCSV('a,b\n1,2\n'), /latitude and longitude/);
});

test('flights split on long time gaps when the log has no flight column', () => {
  const r = parseFlightCSV('elapsed_s,latitude,longitude,spraying\n0,41.9,-93.5,1\n1,41.9,-93.5,1\n500,41.9,-93.5,1\n');
  assert.deepEqual(r.points.map(p => p.flight), ['1', '1', '2']);
  assert.equal(r.meta.relativeTime, true);
});

test('GeoJSON polygons (with holes) become boundaries; LineStrings become tracks', () => {
  const g = { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]], [[0.2, 0.2], [0.3, 0.2], [0.3, 0.3], [0.2, 0.2]]] } },
    { type: 'Feature', properties: { coordTimes: ['2026-06-14T06:00:00Z', '2026-06-14T06:00:01Z'] }, geometry: { type: 'LineString', coordinates: [[-93.5, 41.9], [-93.5, 41.90001]] } },
  ] };
  const r = parseGeoJSON(g);
  assert.equal(r.boundary.length, 1);
  assert.equal(r.boundary[0].length, 2);
  assert.deepEqual(r.boundary[0][0][1], [0, 1]); // [lat, lon]
  assert.equal(r.points.length, 2);
  assert.equal(r.points[1].t - r.points[0].t, 1000);
});

test('KML polygon with inner boundary and gx:Track', () => {
  const kml = `<?xml version="1.0"?><kml><Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>
    -93.5,41.9,0 -93.49,41.9,0 -93.49,41.91,0 -93.5,41.9,0</coordinates></LinearRing></outerBoundaryIs>
    <innerBoundaryIs><LinearRing><coordinates>-93.495,41.902 -93.494,41.902 -93.494,41.903 -93.495,41.902</coordinates></LinearRing></innerBoundaryIs>
    </Polygon></Placemark><Placemark><gx:Track><when>2026-06-14T06:00:00Z</when><when>2026-06-14T06:00:02Z</when>
    <gx:coord>-93.5 41.9 10</gx:coord><gx:coord>-93.4999 41.9 10</gx:coord></gx:Track></Placemark></kml>`;
  const r = parseFile('field.kml', kml);
  assert.equal(r.boundary[0].length, 2);
  assert.equal(r.points.length, 2);
  assert.equal(r.points[1].t - r.points[0].t, 2000);
});

test('a spray_rate or pump_flow column (L/min) is flow, and points with flow are spraying', () => {
  for (const col of ['spray_rate', 'pump_flow']) {
    const csv = `time,lat,lon,${col}\n2026-06-14T10:00:00Z,43.3,-97.9,4.5\n2026-06-14T10:00:01Z,43.30001,-97.9,4.5\n2026-06-14T10:00:02Z,43.30002,-97.9,0\n`;
    const r = parseFlightCSV(csv);
    assert.deepEqual(r.points.map(p => p.spray), [true, true, false], col);
    assert.equal(r.points[0].flowLpm, 4.5, col);
    assert.ok(!r.warnings.some(w => /No spraying found/.test(w)), col);
  }
});

test('a log with zero spraying points gets a warning', () => {
  const r = parseFlightCSV('time,lat,lon,spray_rate\n2026-06-14T10:00:00Z,43.3,-97.9,0\n2026-06-14T10:00:01Z,43.30001,-97.9,0\n');
  assert.ok(r.points.every(p => !p.spray));
  assert.match(r.warnings.join(' '), /No spraying found/);
});

test('KML and GeoJSON tracks without times get no made-up times', () => {
  const kml = parseKML('<kml><Placemark><LineString><coordinates>-97.9,43.3 -97.9,43.3001 -97.9,43.3002</coordinates></LineString></Placemark></kml>');
  assert.ok(kml.timeless);
  assert.ok(kml.points.every(p => p.t === null));
  const gj = parseGeoJSON({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[-97.9, 43.3], [-97.9, 43.3001]] } });
  assert.ok(gj.points.every(p => p.t === null));
});

// ---- maker log profiles (the mechanism; no real maker profile exists yet, see LOG_PROFILES) ----
import { LOG_PROFILES, logProfile, detectColumns } from '../src/parse.js';

test('the generic profile is the default and reads files exactly as before', () => {
  assert.equal(LOG_PROFILES[0].id, 'generic');
  assert.equal(logProfile('no-such-maker').id, 'generic');
  const csv = 'time,lat,lon,flow_l_min\n2026-06-14T10:00:00Z,43.3,-97.9,4.5\n2026-06-14T10:00:01Z,43.30001,-97.9,0\n';
  const a = parseFlightCSV(csv), b = parseFlightCSV(csv, { profile: 'generic' });
  assert.deepEqual(a.points, b.points);
  assert.deepEqual(b.points.map(p => p.spray), [true, false]);
});

// A made-up profile used only to test the mechanism. It is NOT a real maker's format.
const TEST_PROFILE = {
  id: 'test-only', name: 'Test only', models: [],
  cols: { time: ['Rec Time'], lat: ['Lat N'], lon: ['Lon E'], flow: ['Pump Out'], spray: ['Valve'], alt: ['AGL'], speed: ['GS'] },
  flowUnit: 'gpm',
  sprayOn: v => String(v).trim() === 'OPEN',
  time: s => ({ ms: Date.UTC(2026, 5, 14, 10, 0, Number(s)), relative: false, naive: false }),
};

test('a profile maps its own columns, flow unit, spray switch and time format', () => {
  const csv = 'Rec Time,Lat N,Lon E,AGL,GS,Pump Out,Valve\n0,43.3,-97.9,3,5,1.0,OPEN\n1,43.30001,-97.9,3.1,5.2,1.0,CLOSED\n';
  const r = parseFlightCSV(csv, { profile: TEST_PROFILE });
  assert.deepEqual(r.points.map(p => p.t), [Date.UTC(2026, 5, 14, 10, 0, 0), Date.UTC(2026, 5, 14, 10, 0, 1)]);
  assert.equal(r.points[0].lat, 43.3); assert.equal(r.points[0].lon, -97.9);
  assert.equal(r.points[1].alt, 3.1); assert.equal(r.points[1].speed, 5.2);
  assert.ok(Math.abs(r.points[0].flowLpm - 3.785411784) < 1e-9, 'gal/min converted to L/min');
  assert.deepEqual(r.points.map(p => p.spray), [true, false]);
});

test('a profile still falls back to the generic names for columns it does not list', () => {
  const c = detectColumns(['Rec Time', 'latitude', 'longitude', 'Pump Out'], undefined);
  assert.equal(c.lat, 1);
  const r = parseFlightCSV('Rec Time,latitude,longitude,Pump Out\n0,43.3,-97.9,2\n', { profile: TEST_PROFILE });
  assert.equal(r.points[0].lat, 43.3);
  assert.ok(r.points[0].flowLpm > 7, 'profile flow unit applied');
});

test('parseFile passes the chosen profile to CSV files and ignores it for KML', () => {
  const r = parseFile('log.csv', 'Rec Time,Lat N,Lon E,Pump Out,Valve\n0,43.3,-97.9,1,OPEN\n', { profile: TEST_PROFILE });
  assert.equal(r.points[0].spray, true);
  const k = parseFile('t.kml', '<kml><LineString><coordinates>-97.9,43.3 -97.9,43.3001</coordinates></LineString></kml>', { profile: TEST_PROFILE });
  assert.equal(k.points.length, 2);
});
