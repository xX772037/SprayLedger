// Land ownership from county parcel layers published by Planning & Development District III
// (Yankton, SD). Each county's assessment system names its fields differently; the `f` map below
// translates them into one shape. Data is public record from the county Directors of Equalization.
// The services carry no license text: get District III's written OK before charging for this feature.

import { makeProjection, pointInBoundary, ringArea } from './geo.js';
import { downwindEdges } from './weather.js';

const BASE = 'https://gis.districtiii.org/server/rest/services';
const mail = (street, cityLine) => ({ street, cityLine });

// bbox = [south, west, north, east] in degrees, from each layer's own extent.
export const PARCEL_SOURCES = [
  { county: 'Hutchinson', url: `${BASE}/HUTCHINSON_COUNTY_WEB_LAYERS2/MapServer/14`, bbox: [43.1528, -98.1268, 43.5159, -97.3832],
    f: { owner: ['OWNERNAME'], parcel: ['PARCEL_NUM', 'PARCEL_ID'], acres: ['DEEDED_ACRES', 'acres'], legal: ['LEGAL'], ...mail(['MAILING_ADDRESS'], ['MAILING_CITY', 'MAILING_ST', 'MAILING_ZIP']) } },
  { county: 'Hanson', url: `${BASE}/HANSON_COUNTY_WEB_LAYERS/MapServer/4`, bbox: [43.4911, -97.9810, 43.8570, -97.5912],
    f: { owner: ['DEEDHOLDER'], parcel: ['PARCEL_NUMBER', 'PARCEL_ID'], acres: ['DEEDED_ACRE'], legal: ['LEGAL'], ...mail(['MAILING_ADDRESS'], ['MAILING_CITY', 'MAILING_STATE', 'MAILING_ZIP']) } },
  { county: 'Davison', url: `${BASE}/DAVISON_COUNTY_WEB_LAYERS1/MapServer/4`, bbox: [43.4918, -98.3370, 43.8575, -97.9507],
    f: { owner: ['OWNERNAME', 'DEEDHOLDER'], parcel: ['PARCEL_ID'], acres: ['DEEDED_ACRE', 'TOTAL_ACRES'], legal: ['LEGAL'], ...mail(['MAILING_ADDRESS'], ['MAILING_CITY', 'MAILING_STATE', 'MAILING_ZIP']) } },
  { county: 'Douglas', url: `${BASE}/DOUGLAS_COUNTY_WEB_LAYERS/MapServer/3`, bbox: [43.1973, -98.7146, 43.5083, -98.0984],
    f: { owner: ['CAMA_OWNERNAME'], parcel: ['PARCEL_ID'], acres: ['CAMA_ACRES', 'GIS_ACRES'], legal: ['CAMA_LEGAL1'], ...mail(['CAMA_MAILING_ADDRESS'], ['CAMA_MAILING_CITY', 'CAMA_MAILING_STATE', 'CAMA_MAILING_ZIP']) } },
  { county: 'Charles Mix', url: `${BASE}/CHARLES_MIX_WEB_LAYERS3/MapServer/6`, bbox: [42.8377, -99.3166, 43.5062, -98.0581],
    f: { owner: ['deedhold'], parcel: ['Parcelid', 'PARCEL'], acres: ['GrossAcres', 'DIG_ACRES'], legal: ['LegalDesc'], ...mail(['deedaddr1'], ['deedaddr2', 'deedaddr3', 'deedzip']) } },
  { county: 'Bon Homme', url: `${BASE}/BON_HOMME_COUNTY_WEB_LAYERS2/MapServer/1`, bbox: [42.7544, -98.1659, 43.1798, -97.6217],
    f: { owner: ['TC_OWNER'], parcel: ['PARCEL_ID', 'PARCEL'], acres: ['TC_ACRES', 'A1_ACRES'], legal: ['TC_LEGAL1'], ...mail(['TC_ADDRESS'], ['TC_CITY_ST', 'TC_ZIP']) } },
  { county: 'Turner', url: `${BASE}/TURNER_COUNTY_LAYERS/MapServer/4`, bbox: [43.0762, -97.4212, 43.5133, -96.9006],
    f: { owner: ['OWNERNAME'], parcel: ['PARCEL', 'parcel_id'], acres: ['DEEDED_ACRE'], legal: ['LEGAL'], ...mail(['MAILING_ADDRESS'], ['MAILING_CITY', 'MAILING_STATE', 'MAILING_ZIP']) } },
  { county: 'Yankton', url: `${BASE}/YANKTON_PROVAL_LAYERS/MapServer/104`, bbox: [42.7994, -97.6532, 43.1823, -97.1410], paging: false, // joined table: no result paging
    f: { owner: ['DATA3.OWNERNAME1'], parcel: ['PARCEL.PARCEL_ID', 'DATA3.PARCEL_ID'], acres: ['DATA3.DEEDED_ACRES'], legal: ['DATA3.LEGAL1'], ...mail(['DATA3.ADDRESS1', 'DATA3.ADDRESS2'], ['DATA3.ADDRESS3', 'DATA3.ZIP']) } },
];

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
    legal: first(src.f.legal),
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
      for (const f of json.features || []) { const p = normalizeFeature(f, src); if (p) parcels.push(p); }
      if (!json.exceededTransferLimit && !(json.properties?.exceededTransferLimit)) break;
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
    if (pointInBoundary(c[0], c[1], polysXY)) { field.push(p); continue; }
    const rings = p.polygons.map(poly => toXY(poly[0]));
    // Must share real area (over 10 m²) with the search zone; a parcel that only touches the field upwind is left out.
    if (!rings.some(r => zoneXY.some(z => clippedArea(r, z) > 10))) continue;
    others.push({ ...p, distM: ringsDistance(rings, fieldRings) });
  }
  const byOwner = new Map();
  for (const p of others) {
    const key = p.owner ? p.owner.toUpperCase() : `~${p.id}`;
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
