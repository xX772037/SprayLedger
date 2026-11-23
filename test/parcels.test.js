import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PARCEL_SOURCES, normalizeFeature, queryParcels, sourcesFor, neighbourZone, classifyParcels, parcelCenter, clippedArea, parseAddress, numberDistance, searchAddress, legalDescription } from '../src/parcels.js';
import { ringArea } from '../src/geo.js';

const src = name => PARCEL_SOURCES.find(s => s.county === name);
const square = (lat, lon, d) => [[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]];
const feat = (props, lat = 43.3, lon = -97.7, d = 0.002) => ({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [square(lat, lon, d)] } });

test('county field names are mapped into one shape', () => {
  const h = normalizeFeature(feat({ OWNERNAME: ' EXAMPLE  FARMS LLC ', PARCEL_NUM: '12.34', DEEDED_ACRES: 158.2, LEGAL: 'NE4 12-98-58', MAILING_ADDRESS: '100 MAIN ST', MAILING_CITY: 'OLIVET', MAILING_ST: 'SD', MAILING_ZIP: '57052' }), src('Hutchinson'));
  assert.deepEqual([h.owner, h.parcel, h.acres, h.legal, h.mailing, h.county], ['EXAMPLE FARMS LLC', '12.34', 158.2, 'NE4 12-98-58', '100 MAIN ST, OLIVET SD 57052', 'Hutchinson']);
  assert.deepEqual(h.polygons[0][0][0].map(v => +v.toFixed(6)), [43.298, -97.702]); // [lat, lon]

  const y = normalizeFeature(feat({ 'DATA3.OWNERNAME1': 'SAMPLE TRUST', 'PARCEL.PARCEL_ID': 'Y-1', 'DATA3.DEEDED_ACRES': '80', 'DATA3.ADDRESS1': 'PO BOX 1', 'DATA3.ADDRESS3': 'YANKTON SD', 'DATA3.ZIP': '57078' }), src('Yankton'));
  assert.deepEqual([y.owner, y.parcel, y.acres, y.mailing], ['SAMPLE TRUST', 'Y-1', 80, 'PO BOX 1, YANKTON SD 57078']);

  const c = normalizeFeature(feat({ deedhold: 'DOE JANE', Parcelid: 'C9', GrossAcres: 0, deedaddr1: 'RR 1', deedaddr2: 'LAKE ANDES', deedaddr3: 'SD', deedzip: '57356' }), src('Charles Mix'));
  assert.equal(c.acres, null); // zero or missing acreage is "unknown"
  assert.equal(c.mailing, 'RR 1, LAKE ANDES SD 57356');
  assert.equal(normalizeFeature({ properties: {}, geometry: null }, src('Turner')), null);
});

test('only counties overlapping the view are queried', () => {
  assert.deepEqual(sourcesFor([43.30, -97.42, 43.31, -97.39]).map(s => s.county).sort(), ['Hutchinson', 'Turner']);
  assert.deepEqual(sourcesFor([41.9, -93.6, 41.95, -93.5]), []); // Iowa
});

test('query builds an Esri request with clockwise rings and merges duplicate parcels', async () => {
  const urls = [];
  const fetchImpl = async url => {
    urls.push(new URL(url));
    return { ok: true, json: async () => ({ type: 'FeatureCollection', features: [feat({ OWNERNAME: 'A', PARCEL_NUM: '1' }), feat({ OWNERNAME: 'A', PARCEL_NUM: '1' })] }) };
  };
  const ring = [[43.30, -97.70], [43.30, -97.69], [43.31, -97.69], [43.31, -97.70]]; // counter-clockwise in x/y
  const r = await queryParcels({ rings: [ring] }, { fetchImpl });
  assert.deepEqual(r.covered, ['Hutchinson']);
  assert.equal(r.parcels.length, 1);
  const p = urls[0].searchParams;
  assert.equal(p.get('geometryType'), 'esriGeometryPolygon');
  assert.equal(p.get('f'), 'geojson'); assert.equal(p.get('outSR'), '4326');
  const g = JSON.parse(p.get('geometry'));
  assert.ok(ringArea(g.rings[0]) < 0, 'outer ring sent clockwise');
  assert.deepEqual(g.rings[0][0], g.rings[0][g.rings[0].length - 1], 'ring closed');
});

test('Yankton is queried without paging parameters; county failures are reported, not thrown', async () => {
  const seen = [];
  const fetchImpl = async url => {
    seen.push(url);
    if (url.includes('YANKTON')) return { ok: true, json: async () => ({ features: [] }) };
    return { ok: false, status: 500, json: async () => ({}) };
  };
  const r = await queryParcels({ bbox: [43.05, -97.66, 43.2, -97.6] }, { fetchImpl });
  const yk = seen.find(u => u.includes('YANKTON'));
  assert.ok(!yk.includes('resultOffset'));
  assert.ok(r.errors.length >= 1 && r.errors.every(e => /500/.test(e.message)));
});

test('downwind zone sits beyond the downwind edge; parcels split into field and neighbours', () => {
  const field = [[[[43.300, -97.705], [43.300, -97.695], [43.310, -97.695], [43.310, -97.705]]]];
  const zone = neighbourZone(field, 270, 400); // wind from the west → east edge
  assert.equal(zone.rings.length, 1);
  const lons = zone.rings[0].map(p => p[1]);
  // 400 m east at 43.3° N is 0.00494° of longitude
  assert.ok(Math.min(...lons) >= -97.6951 && Math.abs(Math.max(...lons) - (-97.695 + 0.00494)) < 0.0001, 'zone extends 400 m east of the field');

  // A field-sized parcel, two parcels sharing its east edge (downwind), one further east, and one sharing its west edge (upwind).
  const box = (owner, s, w, n, e) => normalizeFeature({ type: 'Feature', properties: { OWNERNAME: owner, PARCEL_NUM: `${owner}${s}` },
    geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } }, src('Hutchinson'));
  const parcels = [
    box('FIELD OWNER', 43.300, -97.705, 43.310, -97.695),
    box('EAST NEIGHBOR', 43.305, -97.695, 43.310, -97.690), box('EAST NEIGHBOR', 43.300, -97.695, 43.305, -97.690),
    box('FAR', 43.300, -97.6905, 43.310, -97.686), // starts ~365 m east, inside the 400 m zone
    box('UPWIND WEST', 43.300, -97.710, 43.310, -97.705),
  ];
  const c = classifyParcels(parcels, zone);
  assert.deepEqual(c.field.map(p => p.owner), ['FIELD OWNER']);
  assert.deepEqual(c.neighbours.map(n => n.owner), ['EAST NEIGHBOR', 'FAR'], 'upwind parcel that only touches the field is left out');
  assert.equal(c.neighbours[0].parcels.length, 2);
  assert.equal(c.neighbours[0].distM, 0, 'adjacent parcel borders the field');
  assert.ok(Math.abs(c.neighbours[1].distM - 365) < 5, `edge-to-edge distance ${c.neighbours[1].distM}`);

  const calm = neighbourZone(field, null, 400);
  assert.equal(calm.downwind, false);
  assert.deepEqual(parcelCenter(parcels[0]).map(v => +v.toFixed(4)), [43.305, -97.7]);
  assert.equal(calm.rings.length, 1);
});

test('clipped area of a parcel inside a convex zone', () => {
  const sq = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  assert.equal(clippedArea(sq(0, 0, 10, 10), sq(5, 0, 20, 10)), 50);           // shared top and bottom edges
  assert.equal(clippedArea(sq(0, 0, 10, 10), sq(10, 0, 20, 10)), 0);           // touching along an edge only
  assert.equal(clippedArea(sq(0, 0, 10, 10), sq(0, 0, 10, 10).reverse()), 100); // either winding
  const L = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]];               // concave parcel
  assert.equal(clippedArea(L, sq(0, 0, 10, 10)), 64);
});

test('addresses are parsed loosely, the way people type them', () => {
  assert.deepEqual(parseAddress('4123 277th street parlston sd'), { num: '4123', street: '277' });
  assert.deepEqual(parseAddress('41255 277TH ST'), { num: '41255', street: '277' });
  assert.deepEqual(parseAddress('101 W Main St, Lake Andes'), { num: '101', street: 'MAIN' });
  assert.equal(parseAddress('  '), null);
});

test('a house number with digits missing is compared as a prefix', () => {
  assert.equal(numberDistance('4123', '41230'), 0);
  assert.ok(numberDistance('4123', '41215') < numberDistance('4123', '41255'));
  assert.equal(numberDistance('41255', '41255'), 0);
});

test('address search: exact match, else nearest numbers on the same road, never other roads', async () => {
  const site = (s, lat) => feat({ SITE_ADDRESS: s, PARCEL_NUM: s, OWNERNAME: 'X' }, lat, -97.95);
  const fetchImpl = async url => ({ ok: true, json: async () => ({ features: url.includes('HUTCHINSON')
    ? [site('41215 277TH ST', 43.37), site('41255 277TH ST', 43.369), site('27778 414TH AVE', 43.36), site('41352 277TH ST', 43.37)] : [] }) });
  const miss = await searchAddress('4123 277th street parlston sd', { fetchImpl });
  assert.deepEqual(miss.exact, []);
  assert.deepEqual(miss.near.map(p => p.site), ['41215 277TH ST', '41255 277TH ST', '41352 277TH ST']);
  const hit = await searchAddress('41255 277th st', { fetchImpl });
  assert.deepEqual(hit.exact.map(p => p.site), ['41255 277TH ST']);
  const road = await searchAddress('277th st', { fetchImpl });
  assert.ok(road.exact.every(p => p.site.includes('277TH ST')), 'a house number starting with 277 is not on 277th St');
});

test('county legal text becomes a section-township-range description', () => {
  assert.equal(legalDescription({ legal: 'W1/2 NE1/4\r\n28.99.60' }), 'W1/2 NE1/4 28-99-60');
  assert.equal(legalDescription({ legal: '' }), '');
});
