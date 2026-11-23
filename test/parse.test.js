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
