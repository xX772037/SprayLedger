// Land ownership from county parcel layers published by Planning & Development District III
// (Yankton, SD): 32 counties across central, south-central, northeast and western South Dakota. Each county's assessment system names its fields differently; the `f` map below
// translates them into one shape. Data is public record from the county Directors of Equalization.
// The services carry no license text: get District III's written OK before charging for this feature.

import { makeProjection, pointInBoundary, ringArea } from './geo.js';
import { downwindEdges } from './weather.js';

const BASE = 'https://gis.districtiii.org/server/rest/services';
const mail = (street, cityLine) => ({ street, cityLine });
// County assessment systems shared by several counties: Thomson Reuters-style "TC_" fields (legal text in up
// to 7 parts) and "CAMA_" fields (legal text in up to 3 parts).
const TC_LEGAL = ['TC_LEGAL1', 'TC_LEGAL2', 'TC_LEGAL3', 'TC_LEGAL4', 'TC_LEGAL5', 'TC_LEGAL6', 'TC_LEGAL7'];
// Ask only for fields a layer has: one unknown field name makes the server refuse the whole query.
const CAMA = { site: ['CAMA_SITE_ADDRESS'], owner: ['CAMA_OWNERNAME'], acres: ['CAMA_ACRES'], legal: ['CAMA_LEGAL1', 'CAMA_LEGAL2', 'CAMA_LEGAL3'],
  ...mail(['CAMA_MAILING_ADDRESS'], ['CAMA_MAILING_CITY', 'CAMA_MAILING_STATE', 'CAMA_MAILING_ZIP']) };

// bbox = [south, west, north, east] in degrees, from each layer's own extent.
export const PARCEL_SOURCES = [
  { county: 'Hutchinson', url: `${BASE}/HUTCHINSON_COUNTY_WEB_LAYERS2/MapServer/14`, bbox: [43.1528, -98.1268, 43.5159, -97.3832],
    f: { site: ['SITE_ADDRESS'], owner: ['OWNERNAME'], parcel: ['PARCEL_NUM', 'PARCEL_ID'], acres: ['DEEDED_ACRES', 'acres'], legal: ['LEGAL'], ...mail(['MAILING_ADDRESS'], ['MAILING_CITY', 'MAILING_ST', 'MAILING_ZIP']) } },
  { county: 'Hanson', url: `${BASE}/HANSON_COUNTY_WEB_LAYERS/MapServer/4`, bbox: [43.4911, -97.9810, 43.8570, -97.5912],
    f: { site: ['SITE_ADDRESS'], owner: ['DEEDHOLDER'], parcel: ['PARCEL_NUMBER', 'PARCEL_ID'], acres: ['DEEDED_ACRE'], legal: ['LEGAL'], ...mail(['MAILING_ADDRESS'], ['MAILING_CITY', 'MAILING_STATE', 'MAILING_ZIP']) } },
  { county: 'Davison', url: `${BASE}/DAVISON_COUNTY_WEB_LAYERS1/MapServer/4`, bbox: [43.4918, -98.3370, 43.8575, -97.9507],
    f: { site: ['SITE_ADDRESS'], owner: ['OWNERNAME', 'DEEDHOLDER'], parcel: ['PARCEL_ID'], acres: ['DEEDED_ACRE', 'TOTAL_ACRES'], legal: ['LEGAL'], ...mail(['MAILING_ADDRESS'], ['MAILING_CITY', 'MAILING_STATE', 'MAILING_ZIP']) } },
  { county: 'Douglas', url: `${BASE}/DOUGLAS_COUNTY_WEB_LAYERS/MapServer/3`, bbox: [43.1973, -98.7146, 43.5083, -98.0984],
    f: { site: ['CAMA_SITE_ADDRESS'], owner: ['CAMA_OWNERNAME'], parcel: ['PARCEL_ID'], acres: ['CAMA_ACRES', 'GIS_ACRES'], legal: ['CAMA_LEGAL1'], ...mail(['CAMA_MAILING_ADDRESS'], ['CAMA_MAILING_CITY', 'CAMA_MAILING_STATE', 'CAMA_MAILING_ZIP']) } },
  { county: 'Charles Mix', url: `${BASE}/CHARLES_MIX_WEB_LAYERS3/MapServer/6`, bbox: [42.8377, -99.3166, 43.5062, -98.0581],
    f: { site: ['ADDRESS'], owner: ['deedhold'], parcel: ['Parcelid', 'PARCEL'], acres: ['GrossAcres', 'DIG_ACRES'], legal: ['LegalDesc'], ...mail(['deedaddr1'], ['deedaddr2', 'deedaddr3', 'deedzip']) } },
  { county: 'Bon Homme', url: `${BASE}/BON_HOMME_COUNTY_WEB_LAYERS2/MapServer/1`, bbox: [42.7544, -98.1659, 43.1798, -97.6217],
    f: { site: ['TC_SITE_ADDRESS'], owner: ['TC_OWNER'], parcel: ['PARCEL_ID', 'PARCEL'], acres: ['TC_ACRES', 'A1_ACRES'], legal: ['TC_LEGAL1'], ...mail(['TC_ADDRESS'], ['TC_CITY_ST', 'TC_ZIP']) } },
  { county: 'Turner', url: `${BASE}/TURNER_COUNTY_LAYERS/MapServer/4`, bbox: [43.0762, -97.4212, 43.5133, -96.9006],
    f: { site: ['SITE_ADDRESS'], owner: ['OWNERNAME'], parcel: ['PARCEL', 'parcel_id'], acres: ['DEEDED_ACRE'], legal: ['LEGAL'], ...mail(['MAILING_ADDRESS'], ['MAILING_CITY', 'MAILING_STATE', 'MAILING_ZIP']) } },
  { county: 'Yankton', url: `${BASE}/YANKTON_PROVAL_LAYERS/MapServer/104`, bbox: [42.7994, -97.6532, 43.1823, -97.1410], paging: false, // joined table: no result paging
    f: { site: ['DATA3.SITE_ADDRESS'], owner: ['DATA3.OWNERNAME1'], parcel: ['PARCEL.PARCEL_ID', 'DATA3.PARCEL_ID'], acres: ['DATA3.DEEDED_ACRES'], legal: ['DATA3.LEGAL1'], ...mail(['DATA3.ADDRESS1', 'DATA3.ADDRESS2'], ['DATA3.ADDRESS3', 'DATA3.ZIP']) } },
  // ---- Added November 2026: the other counties District III serves (fields mapped from each live layer) ----
  { county: 'Aurora', url: `${BASE}/AURORA_COUNTY_WEB_LAYERS/MapServer/8`, bbox: [43.4919, -98.8190, 43.9451, -98.3059],
    f: { site: ['SITE_ADDRESS'], owner: ['OWNERNAME'], parcel: ['PARCEL_ID'], acres: ['DEEDED_ACRE'], legal: ['LEGAL'], ...mail(['MAILING_ADDRESS'], ['MAILING_CITY', 'MAILING_STATE', 'MAILING_ZIP']) } },
  { county: 'Bennett', url: `${BASE}/BENNETT_COUNTY_WEB_LAYERS/MapServer/4`, bbox: [42.9874, -102.1165, 43.4003, -101.2225],
    f: { site: ['SITE_ADDRESS'], owner: ['OWNERNAME', 'ADD_OWNER'], parcel: ['PARCEL_LINK', 'PARCEL_ID'], acres: ['DEEDED_ACRE'], legal: ['LEGAL'], ...mail(['MAILING_ADDRESS'], ['MAILING_CITY', 'MAILING_ST', 'MAILING_STATE', 'MAILING_ZIP']) } },
  { county: 'Brule', url: `${BASE}/BRULE_COUNTY_WEB_LAYERS/MapServer/12`, bbox: [43.4936, -99.5034, 43.9422, -98.7835], joinLegal: true,
    f: { site: ['TC_SITE_ADDRESS'], owner: ['TC_OWNER'], parcel: ['PARCEL_ID', 'PARCEL'], acres: ['TC_ACRES', 'A1_ACRES'], legal: TC_LEGAL, ...mail(['TC_ADDRESS'], ['TC_CITY_ST', 'TC_ZIP']) } },
  { county: 'Buffalo', url: `${BASE}/BUFFALO_COUNTY_WEB_LAYERS/MapServer/20`, bbox: [43.9291, -99.5761, 44.2027, -98.9211],
    f: { site: ['SITEADDRES'], owner: ['OWNERNAME', 'ADDOWNER'], parcel: ['PARCEL_ID'], acres: ['DEEDED_ACRE'], legal: ['LEGAL'], ...mail(['OWNERSTREE'], ['OWNERCITY', 'OWNERST', 'OWNERZIP']) } },
  { county: 'Butte', url: `${BASE}/BUTTE_COUNTY_WEB_LAYERS2/MapServer/3`, bbox: [44.5705, -104.1013, 45.2461, -102.9266], joinLegal: true,
    f: { site: ['TC_SITE_ADDRESS'], owner: ['TC_OWNER'], parcel: ['PARCEL', 'parcel_id'], acres: ['TC_ACRES', 'A1_ACRES'], legal: TC_LEGAL, ...mail(['TC_ADDRESS'], ['TC_CITY_ST', 'TC_ZIP']) } },
  { county: 'Campbell', url: `${BASE}/CAMPBELL_COUNTY_WEB_LAYERS/MapServer/22`, bbox: [45.5923, -100.5119, 45.9447, -99.7157],
    f: { site: ['SITE_ADDRESS'], owner: ['OWNERNAME', 'ADD_OWNER'], parcel: ['PARCEL_ID', 'PARCEL_LINK'], acres: ['DEEDED_ACRE'], legal: ['LEGAL'], ...mail(['MAILING_ADDRESS'], ['MAILING_CITY', 'MAILING_STATE', 'MAILING_ZIP']) } },
  { county: 'Day', url: `${BASE}/DAY_COUNTY_WEB_LAYERS/MapServer/7`, bbox: [45.1375, -97.9949, 45.5999, -97.2052], joinLegal: true,
    f: { site: ['TC_SITE_ADDRESS', 'SITEADDRESS'], owner: ['TC_OWNER', 'OWNERNAME'], parcel: ['PARCEL_ID', 'PARCEL'], acres: ['TC_ACRES', 'A1_ACRES', 'DEEDEDACRES'], legal: TC_LEGAL, ...mail(['TC_ADDRESS'], ['TC_CITY_ST', 'TC_ZIP']) } },
  { county: 'Faulk', url: `${BASE}/FAULK_COUNTY_WEB_LAYERS/MapServer/3`, bbox: [44.8911, -99.5759, 45.2501, -98.7087],
    f: { site: ['SITE_ADDRESS'], owner: ['DEED_HOLDER', 'TAX_OWNER_NAME_1'], parcel: ['PARCEL_ID', 'PARCEL_NUMBER_PIN'], acres: ['DEEDED_ACRES', 'TOTAL_ACRES'], legal: ['LEGAL'], ...mail(['MAIL_TO_ADDRESS_1', 'MAIL_TO_ADDRESS_2'], ['MAIL_TO_CITY', 'MAIL_TO_STATE', 'MAIL_TO_ZIP']) } },
  { county: 'Gregory', url: `${BASE}/GREGORY_COUNTY_WEB_LAYERS/MapServer/5`, bbox: [42.9861, -99.5404, 43.5019, -98.4950], joinLegal: true,
    f: { ...CAMA, parcel: ['PIDLINK', 'PID'], acres: ['CAMA_ACRES', 'acres'] } },
  { county: 'Haakon', url: `${BASE}/HAAKON_COUNTY_WEB_LAYERS/MapServer/15`, bbox: [43.9851, -102.0289, 44.7510, -101.0453],
    f: { site: ['SITE_ADDRESS'], owner: ['DEEDHOLDER'], parcel: ['PARCEL_NUMBER', 'PARCELID'], acres: ['DEEDED_ACRES', 'acres'], legal: ['LEGAL'], ...mail(['MAILING_ADDRESS_LINE1'], ['CITY_ADD', 'STATE_ADD', 'ZIP_ADD']) } },
  { county: 'Hughes', url: `${BASE}/HUGHES_COUNTY_WEB_LAYERS/MapServer/2`, bbox: [44.0968, -100.5818, 44.5489, -99.5959], joinLegal: true,
    f: { ...CAMA, parcel: ['PARCEL_ID'] } },
  { county: 'Jackson', url: `${BASE}/JACKSON_COUNTY_WEB_LAYERS2/MapServer/42`, bbox: [43.3784, -102.1543, 44.0047, -101.0569],
    f: { site: ['SITE_ADDRESS'], owner: ['DEEDHOLDER'], parcel: ['PARCEL_NUMBER', 'PARCEL_ID'], acres: ['DEEDED_ACRES', 'acres'], legal: ['LEGAL'], ...mail(['MAILING_ADDRESS_LINE1'], ['CITY_ADD', 'STATE_ADD', 'ZIP_ADD']) } },
  { county: 'Jerauld', url: `${BASE}/JERAULD_COUNTY_WEB_LAYERS/MapServer/9`, bbox: [43.9263, -98.9323, 44.2055, -98.3229], joinLegal: true,
    f: { ...CAMA, parcel: ['PARCEL_ID'] } },
  // Jones publishes no mailing address.
  { county: 'Jones', url: `${BASE}/JONES_COUNTY_WEB_LAYERS/MapServer/8`, bbox: [43.7040, -101.0679, 44.1705, -100.3389],
    f: { site: ['SITE_ADDRESS'], owner: ['OWNERNAME'], parcel: ['PARCEL_ID', 'PID_LINK'], acres: ['DEEDED_ACRE'], legal: ['LEGAL'], ...mail([], []) } },
  { county: 'Lyman', url: `${BASE}/LYMAN_COUNTY_WEB_LAYERS/MapServer/0`, bbox: [43.4970, -100.3673, 44.2258, -99.2526], joinLegal: true,
    f: { ...CAMA, parcel: ['PIDLINK'], acres: ['CAMA_ACRES', 'acres'] } },
  // Marshall writes the state into the city field ("WEST FARGO ND").
  { county: 'Marshall', url: `${BASE}/MARSHALL_COUNTY_WEB_LAYERS/MapServer/3`, bbox: [45.5556, -97.9917, 45.9507, -97.2086],
    f: { site: ['SITE_ADDRESS'], owner: ['OWNERNAME'], parcel: ['PARCEL_ID', 'Parcel_ID_1'], acres: ['DEEDED_ACRE'], legal: ['LEGAL'], ...mail(['MAILING_ADDRESS'], ['MAILING_CITY', 'MAILING_ZIP']) } },
  { county: 'McPherson', url: `${BASE}/MCPHERSON_COUNTY_WEB_LAYERS/MapServer/2`, bbox: [45.5867, -99.7198, 45.9454, -98.7175],
    f: { site: ['SITE_ADDRESS'], owner: ['OWNERNAME'], parcel: ['PARCEL_NUMBER', 'PARCEL_ID'], acres: ['DEEDED_ACRE'], legal: ['LEGAL'], ...mail(['MAILING_ADDRESS'], ['MAILING_CITY', 'MAILING_ST', 'MAILING_ZIP']) } },
  { county: 'Mellette', url: `${BASE}/MELLETTE_COUNTY_WEB_LAYERS/MapServer/5`, bbox: [43.3865, -101.2352, 43.8625, -100.2132], joinLegal: true,
    f: { ...CAMA, parcel: ['PARCEL_ID'] } },
  { county: 'Potter', url: `${BASE}/POTTER_COUNTY_WEB_LAYERS/MapServer/2`, bbox: [44.8968, -100.4263, 45.2475, -99.5702], joinLegal: true,
    f: { ...CAMA, parcel: ['PARCEL_ID'] } },
  { county: 'Sanborn', url: `${BASE}/SANBORN_COUNTY_WEB_LAYERS/MapServer/13`, bbox: [43.8416, -98.3434, 44.2046, -97.8368], joinLegal: true,
    f: { ...CAMA, parcel: ['PARCEL_ID'] } },
  { county: 'Stanley', url: `${BASE}/STANLEY_COUNTY_WEB_LAYERS/MapServer/2`, bbox: [44.1632, -101.1794, 44.7877, -99.8912], joinLegal: true,
    f: { ...CAMA, parcel: ['PARCEL_ID', 'PARCELID'] } },
  { county: 'Sully', url: `${BASE}/SULLY_COUNTY_WEB_LAYERS/MapServer/2`, bbox: [44.5460, -100.7133, 44.8988, -99.6739], joinLegal: true,
    f: { ...CAMA, parcel: ['PARCEL_ID'], acres: ['CAMA_ACRES', 'ACRES'] } },
  // One layer for both counties; the parcel number tells them apart.
  { county: 'Tripp and Todd', url: `${BASE}/TRIPP_TODD_WEB_LAYERS/MapServer/6`, bbox: [42.9949, -101.2395, 43.7769, -99.5239], joinLegal: true,
    f: { site: ['TC_SITE_ADDRESS'], owner: ['TC_OWNER'], parcel: ['TRIPP_TODD_PARCEL_ID', 'PARCEL'], acres: ['TC_ACRES', 'A1_ACRES'], legal: TC_LEGAL, ...mail(['TC_ADDRESS'], ['TC_CITY_ST', 'TC_ZIP']) } },
  { county: 'Ziebach', url: `${BASE}/ZIEBACH_COUNTY_WEB_LAYERS/MapServer/3`, bbox: [44.5172, -102.0351, 45.4841, -101.1279],
    f: { site: ['VALUES_SITUSADDRESS'], owner: ['DEED_HOLDER', 'TAX_OWNER_NAME_1'], parcel: ['PARCEL_ID', 'PARCEL_NUMBER_PIN'], acres: ['DEEDED_ACRES', 'TOTAL_ACRES'], legal: ['LEGAL'], ...mail(['MAIL_TO_ADDRESS_1', 'MAIL_TO_ADDRESS_2'], ['MAIL_TO_CITY', 'MAIL_TO_STATE', 'MAIL_TO_ZIP']) } },
];

/** "Day County", or "Tripp and Todd counties" for the one layer that covers two. */
export const countyLabel = name => (name.includes(' and ') ? `${name} counties` : `${name} County`);
/** How many counties have parcel data (the Tripp and Todd layer counts as two). */
export const COUNTY_COUNT = PARCEL_SOURCES.reduce((n, s) => n + s.county.split(' and ').length, 0);
/** Every covered county by name, alphabetically. */
export const COUNTY_NAMES = PARCEL_SOURCES.flatMap(s => s.county.split(' and ')).sort((a, b) => a.localeCompare(b));

export const PARCEL_ATTRIBUTION = 'Parcels &copy; county Directors of Equalization, via Planning &amp; Development District III';
export const NOT_COVERED_NEARBY = ['McCook County (its parcel map is on Schneider Beacon, not District III)'];

const intersects = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
export const sourcesFor = bbox => PARCEL_SOURCES.filter(s => intersects(s.bbox, bbox));

const clean = v => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());

/** Convert one GeoJSON feature from a county layer into { id, county, owner, parcel, acres, legal, mailing, polygons }. */
export function normalizeFeature(feature, src) {
  const p = feature.properties || {};
  const first = keys => keys.map(k => clean(p[k])).find(v => v !== '') ?? '';
  const joined = keys => keys.map(k => clean(p[k])).filter(Boolean).join(' ');
  const g = feature.geometry;
  const polys = !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  if (!polys.length) return null;
  const parcel = first(src.f.parcel);
  const acres = parseFloat(first(src.f.acres));
  const street = joined(src.f.street), cityLine = joined(src.f.cityLine);
  return {
    id: `${src.county}:${parcel || p.OBJECTID || p['PARCEL.OBJECTID'] || feature.id}`,
    county: src.county,
    owner: first(src.f.owner),
    parcel,
    acres: Number.isFinite(acres) && acres > 0 ? acres : null,
    // Some counties split the legal text over several fields: join them in order.
    legal: src.joinLegal ? joined(src.f.legal) : first(src.f.legal),
    site: first(src.f.site || []),
    mailing: [street, cityLine].filter(Boolean).join(', '),
    polygons: polys.map(poly => poly.map(ring => ring.map(([lon, lat]) => [lat, lon]))),
  };
}

/** A parcel's representative point: the vertex average of its largest outer ring. */
export function parcelCenter(parcel) {
  const ring = parcel.polygons.map(p => p[0]).sort((a, b) => b.length - a.length)[0];
  const n = ring.length - (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? 1 : 0);
  let la = 0, lo = 0;
  for (let i = 0; i < n; i++) { la += ring[i][0]; lo += ring[i][1]; }
  return [la / n, lo / n];
}

// Every ring sent is an outer ring (the field's outline and the search strips; never holes), so all are clockwise.
function esriGeometry(geom) {
  if (geom.bbox) {
    const [s, w, n, e] = geom.bbox;
    return { type: 'esriGeometryEnvelope', json: { xmin: w, ymin: s, xmax: e, ymax: n, spatialReference: { wkid: 4326 } } };
  }
  // rings of [lat, lon]; Esri wants [x, y] outer rings clockwise
  const rings = geom.rings.map(r => {
    const xy = r.map(([lat, lon]) => [lon, lat]);
    if (xy.length && (xy[0][0] !== xy[xy.length - 1][0] || xy[0][1] !== xy[xy.length - 1][1])) xy.push(xy[0]);
    return ringArea(xy) > 0 ? xy.reverse() : xy;
  });
  return { type: 'esriGeometryPolygon', json: { rings, spatialReference: { wkid: 4326 } } };
}

function bboxOf(geom) {
  if (geom.bbox) return geom.bbox;
  const pts = geom.rings.flat();
  return [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
}

/**
 * Parcels intersecting a bbox ({ bbox: [s, w, n, e] }) or polygon ({ rings: [[[lat, lon], ...]] }),
 * from every covered county that overlaps it. Returns { parcels, errors, covered }.
 */
export async function queryParcels(geom, { fetchImpl = fetch, signal, maxPages = 3 } = {}) {
  const srcs = sourcesFor(bboxOf(geom));
  const g = esriGeometry(geom);
  const errors = [], parcels = [];
  await Promise.all(srcs.map(async src => {
    const outFields = [...new Set(Object.values(src.f).flat())].join(',');
    const pages = src.paging === false ? 1 : maxPages;
    for (let page = 0; page < pages; page++) {
      const q = new URLSearchParams({
        where: '1=1', geometry: JSON.stringify(g.json), geometryType: g.type, inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects', outFields, returnGeometry: 'true', outSR: '4326',
        geometryPrecision: '6', maxAllowableOffset: '0.000004', f: 'geojson',
      });
      if (src.paging !== false) { q.set('resultRecordCount', '1000'); q.set('resultOffset', String(page * 1000)); }
      let json;
      try {
        const res = await fetchImpl(`${src.url}/query?${q}`, { signal });
        if (!res.ok) throw new Error(`answered ${res.status}`);
        json = await res.json();
        if (json.error) throw new Error(json.error.message || 'query error');
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        errors.push({ county: src.county, message: e.message || 'unreachable' });
        return;
      }
      const feats = json.features || [];
      for (const f of feats) { const p = normalizeFeature(f, src); if (p) parcels.push(p); }
      // GeoJSON output may not carry the "more results" flag, so a full page always means: ask for the next one.
      const more = json.exceededTransferLimit || json.properties?.exceededTransferLimit || feats.length >= 1000;
      if (!more) break;
      if (page === pages - 1) errors.push({ county: src.county, message: 'more parcels than one look-up returns; zoom in' });
    }
  }));
  // Same parcel can come back from two pages or adjacent counties' edges.
  const seen = new Set();
  return { parcels: parcels.filter(p => (seen.has(p.id) ? false : seen.add(p.id))), errors, covered: srcs.map(s => s.county) };
}

/**
 * Zones to search for neighbours: strips `distM` deep beyond each downwind edge of the field,
 * or, with no wind, the field's bounding box grown by `distM` all round. Rings are [lat, lon].
 */
export function neighbourZone(boundaryLL, windFromDeg, distM) {
  const ring0 = boundaryLL[0][0];
  const lat0 = ring0.reduce((s, p) => s + p[0], 0) / ring0.length, lon0 = ring0.reduce((s, p) => s + p[1], 0) / ring0.length;
  const proj = makeProjection(lat0, lon0);
  const polysXY = boundaryLL.map(p => p.map(r => r.map(([a, b]) => proj.toXY(a, b))));
  const ll = ([x, y]) => proj.toLatLon(x, y);
  if (windFromDeg == null) {
    const xs = polysXY.flatMap(p => p[0].map(q => q[0])), ys = polysXY.flatMap(p => p[0].map(q => q[1]));
    const [x0, x1, y0, y1] = [Math.min(...xs) - distM, Math.max(...xs) + distM, Math.min(...ys) - distM, Math.max(...ys) + distM];
    return { proj, polysXY, downwind: false, rings: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(ll)] };
  }
  const { edges, towardDeg } = downwindEdges(polysXY, windFromDeg);
  const r = towardDeg * Math.PI / 180, v = [Math.sin(r) * distM, Math.cos(r) * distM];
  const rings = edges.map(([a, b]) => [a, b, [b[0] + v[0], b[1] + v[1]], [a[0] + v[0], a[1] + v[1]]].map(ll));
  return { proj, polysXY, downwind: true, towardDeg, rings };
}

function distToSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

const edgesOf = ring => ring.map((a, i) => [a, ring[(i + 1) % ring.length]]);

function pointStrictlyInRing([x, y], ring, eps = 0.5) {
  if (edgesOf(ring).some(([a, b]) => distToSegment([x, y], a, b) < eps)) return false; // on the edge
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segmentsCross([a, b], [c, d]) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0; // proper crossing only: shared edges and corners don't count
}

/** Do two rings overlap with positive area? (Touching along an edge or at a corner is not overlap.) */
export function ringsOverlap(A, B) {
  if (A.some(p => pointStrictlyInRing(p, B)) || B.some(p => pointStrictlyInRing(p, A))) return true;
  const ea = edgesOf(A), eb = edgesOf(B);
  if (ea.some(e => eb.some(f => segmentsCross(e, f)))) return true;
  // identical or edge-sharing shapes: test the midpoints of A's edges nudged inward
  const cx = A.reduce((s, p) => s + p[0], 0) / A.length, cy = A.reduce((s, p) => s + p[1], 0) / A.length;
  return pointStrictlyInRing([cx, cy], B) && pointStrictlyInRing([cx, cy], A);
}

/** Area of the part of `subject` (any simple ring) inside `clip` (a convex ring), by Sutherland–Hodgman clipping. */
export function clippedArea(subject, clip) {
  const cw = ringArea(clip) < 0;
  const c = cw ? clip.slice().reverse() : clip;            // make the clip ring counter-clockwise
  let out = subject.slice();
  for (let i = 0; i < c.length && out.length; i++) {
    const a = c[i], b = c[(i + 1) % c.length];
    const inside = p => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0;
    const cross = (p, q) => {
      const A1 = b[1] - a[1], B1 = a[0] - b[0], C1 = A1 * a[0] + B1 * a[1];
      const A2 = q[1] - p[1], B2 = p[0] - q[0], C2 = A2 * p[0] + B2 * p[1];
      const det = A1 * B2 - A2 * B1;
      return [(B2 * C1 - B1 * C2) / det, (A1 * C2 - A2 * C1) / det];
    };
    const input = out; out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j], q = input[(j + 1) % input.length];
      const pin = inside(p), qin = inside(q);
      if (pin) out.push(p);
      if (pin !== qin) out.push(cross(p, q));
    }
  }
  return out.length > 2 ? Math.abs(ringArea(out)) : 0;
}

/** Shortest distance between two sets of rings, 0 when they touch or overlap. */
function ringsDistance(As, Bs) {
  let d = Infinity;
  for (const A of As) for (const B of Bs) {
    if (ringsOverlap(A, B)) return 0;
    for (const p of A) for (const [a, b] of edgesOf(B)) d = Math.min(d, distToSegment(p, a, b));
    for (const p of B) for (const [a, b] of edgesOf(A)) d = Math.min(d, distToSegment(p, a, b));
  }
  return d;
}

/** Fraction of a parcel's area that lies inside the field, estimated on a 20 × 20 grid of points. */
function shareInside(rings, polysXY) {
  const pts = rings.flat();
  const [x0, x1] = [Math.min(...pts.map(p => p[0])), Math.max(...pts.map(p => p[0]))];
  const [y0, y1] = [Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[1]))];
  let inParcel = 0, inBoth = 0;
  for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) {
    const x = x0 + (i + 0.5) * (x1 - x0) / 20, y = y0 + (j + 0.5) * (y1 - y0) / 20;
    if (!rings.some(r => pointInBoundary(x, y, [[r]]))) continue;
    inParcel++;
    if (pointInBoundary(x, y, polysXY)) inBoth++;
  }
  return inParcel ? inBoth / inParcel : 0;
}

/**
 * Split parcels into those that make up the field (centre inside the boundary) and neighbours that
 * overlap the search zone, grouped by owner and sorted by edge-to-edge distance from the field.
 */
export function classifyParcels(parcels, zone) {
  const { proj, polysXY } = zone;
  const toXY = ring => ring.map(([la, lo]) => proj.toXY(la, lo));
  const zoneXY = zone.rings.map(toXY);
  const fieldRings = polysXY.map(p => p[0]);
  const field = [], others = [];
  for (const p of parcels) {
    const c = proj.toXY(...parcelCenter(p));
    const rings = p.polygons.map(poly => toXY(poly[0]));
    // Part of the field when its centre is inside, or when at least half the parcel lies inside the field
    // (catches L-shaped parcels and parcels that straddle the field edge).
    if (pointInBoundary(c[0], c[1], polysXY) || shareInside(rings, polysXY) >= 0.5) { field.push(p); continue; }
    // Must share real area (over 10 m²) with the search zone; a parcel that only touches the field upwind is left out.
    if (!rings.some(r => zoneXY.some(z => clippedArea(r, z) > 10))) continue;
    others.push({ ...p, distM: ringsDistance(rings, fieldRings) });
  }
  const byOwner = new Map();
  for (const p of others) {
    // Same name AND same mailing address: two different people who share a name stay separate.
    const key = p.owner ? `${p.owner.toUpperCase()}|${String(p.mailing || '').toUpperCase()}` : `~${p.id}`;
    const g = byOwner.get(key) || { owner: p.owner, mailing: p.mailing, parcels: [], distM: Infinity, acres: 0 };
    g.parcels.push(p); g.distM = Math.min(g.distM, p.distM); g.acres += p.acres || 0;
    if (!g.mailing && p.mailing) g.mailing = p.mailing;
    byOwner.set(key, g);
  }
  return { field, neighbours: [...byOwner.values()].sort((a, b) => a.distM - b.distM) };
}

/** Downwind edges of a boundary in [lat, lon], for drawing. */
export function downwindEdgesLL(boundaryLL, windFromDeg) {
  const z = neighbourZone(boundaryLL, windFromDeg, 1);
  return z.rings.map(r => [r[0], r[1]]);
}

// ---------- address search ----------

const ORDINAL = /^(\d+)(ST|ND|RD|TH)$/;
const STREET_WORDS = new Set(['ST', 'STREET', 'AVE', 'AVENUE', 'RD', 'ROAD', 'DR', 'DRIVE', 'LN', 'LANE', 'BLVD', 'HWY', 'HIGHWAY', 'N', 'S', 'E', 'W', 'SD', 'SOUTH', 'DAKOTA']);

/** "4123 277th street parkston sd" → { num: '4123', street: '277' }. Returns null when there's nothing to search for. */
export function parseAddress(text) {
  const t = String(text).toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!t.length) return null;
  const num = /^\d+$/.test(t[0]) ? t.shift() : null;
  // "County Road 5", "CR 5", "Highway 37": the road is the number that follows.
  const k = t.findIndex((w, i) => (w === 'COUNTY' && /^(ROAD|RD)$/.test(t[i + 1] || '')) || /^(CR|HWY|HIGHWAY|SH|US)$/.test(w));
  if (k !== -1) {
    const n = t.slice(k + 1).find(w => /^\d+$/.test(w));
    if (n) return { num, street: n };
  }
  const words = t.filter(w => !STREET_WORDS.has(w));
  if (!words.length) return null;
  const m = words[0].match(ORDINAL);
  return { num, street: m ? m[1] : words[0] };
}

const houseNo = addr => { const m = String(addr).trim().match(/^(\d+)/); return m ? m[1] : null; };

/** How close a house number is to what was typed; a typed number with missing digits is compared as a prefix. */
export function numberDistance(typed, actual) {
  if (!typed || !actual) return Infinity;
  if (actual.startsWith(typed)) return 0;
  const scale = actual.length > typed.length ? 10 ** (actual.length - typed.length) : 1;
  return Math.abs(Number(typed) * scale - Number(actual));
}

/**
 * Find parcels by site address in every covered county.
 * Returns { query, exact: [parcel], near: [parcel] } — near holds the closest house numbers on the same road
 * when nothing matches exactly.
 */
export async function searchAddress(text, { fetchImpl = fetch, signal } = {}) {
  const q = parseAddress(text);
  if (!q) return { query: null, exact: [], near: [] };
  const all = [];
  await Promise.all(PARCEL_SOURCES.map(async src => {
    const field = src.f.site?.[0];
    if (!field) return;
    // Rural roads are written "277TH ST" in most counties and "277 ST" in some.
    const where = `UPPER(${field}) LIKE '%${q.street}%'` + (q.num ? ` AND UPPER(${field}) LIKE '%${q.num.slice(0, 2)}%'` : '');
    const outFields = [...new Set(Object.values(src.f).flat())].join(',');
    const p = new URLSearchParams({ where, outFields, returnGeometry: 'true', outSR: '4326', geometryPrecision: '6', maxAllowableOffset: '0.000004', f: 'geojson' });
    if (src.paging !== false) p.set('resultRecordCount', '400');
    try {
      const res = await fetchImpl(`${src.url}/query?${p}`, { signal });
      if (!res.ok) return;
      const json = await res.json();
      for (const f of json.features || []) {
        const parcel = normalizeFeature(f, src);
        if (!parcel?.site) continue;
        const words = parcel.site.toUpperCase().trim().split(/\s+/);
        if (/^\d+$/.test(words[0])) words.shift(); // the house number isn't the road
        const onRoad = words.some(w => w === q.street || w.match(ORDINAL)?.[1] === q.street);
        if (onRoad) all.push(parcel);
      }
    } catch (e) { if (e.name === 'AbortError') throw e; }
  }));
  const seen = new Set();
  const uniq = all.filter(p => (seen.has(p.id) ? false : seen.add(p.id)));
  if (!q.num) return { query: q, exact: uniq.slice(0, 8), near: [] };
  const exact = uniq.filter(p => houseNo(p.site) === q.num);
  if (exact.length) return { query: q, exact, near: [] };
  const ranked = uniq.filter(p => houseNo(p.site)).sort((a, b) => numberDistance(q.num, houseNo(a.site)) - numberDistance(q.num, houseNo(b.site)));
  const prefix = ranked.filter(p => houseNo(p.site).startsWith(q.num));
  return { query: q, exact: prefix.slice(0, 6), near: prefix.length ? [] : ranked.slice(0, 4) };
}

/** County legal text like "W1/2 NE1/4\r\n28.99.60" → "W1/2 NE1/4 28-99-60" (section-township-range). */
export function legalDescription(parcel) {
  return String(parcel?.legal || '').replace(/\s+/g, ' ').trim().replace(/\b(\d{1,2})\.(\d{2,3})\.(\d{2,3})\b/, '$1-$2-$3');
}
