// Geometry helpers. Field-scale work uses a local equirectangular projection (metres east/north of an origin),
// which is accurate to well under 0.1% over a few kilometres.

export const EARTH_R = 6371008.8;
export const M2_PER_ACRE = 4046.8564224;
export const L_PER_GAL = 3.785411784;
export const M_PER_FT = 0.3048;

const RAD = Math.PI / 180;

export function makeProjection(lat0, lon0) {
  const k = Math.cos(lat0 * RAD);
  return {
    lat0, lon0,
    toXY: (lat, lon) => [(lon - lon0) * RAD * EARTH_R * k, (lat - lat0) * RAD * EARTH_R],
    toLatLon: (x, y) => [lat0 + (y / EARTH_R) / RAD, lon0 + (x / (EARTH_R * k)) / RAD],
  };
}

/** Signed shoelace area of a ring of [x, y] points (positive when counter-clockwise). */
export function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return -a / 2;
}

/**
 * A boundary is a list of polygons; each polygon is [outerRing, ...holeRings].
 * Area = sum of outer rings minus holes.
 */
export function boundaryArea(polygonsXY) {
  let total = 0;
  for (const poly of polygonsXY) {
    poly.forEach((ring, i) => { total += (i === 0 ? 1 : -1) * Math.abs(ringArea(ring)); });
  }
  return total;
}

export function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInBoundary(x, y, polygonsXY) {
  for (const poly of polygonsXY) {
    if (!pointInRing(x, y, poly[0])) continue;
    if (poly.slice(1).some(h => pointInRing(x, y, h))) continue;
    return true;
  }
  return false;
}

export function centroidLatLon(polygonsLL, fallbackPoints = []) {
  let sx = 0, sy = 0, n = 0;
  for (const poly of polygonsLL) for (const [lat, lon] of poly[0]) { sx += lat; sy += lon; n++; }
  if (!n) for (const p of fallbackPoints) { sx += p.lat; sy += p.lon; n++; }
  return n ? [sx / n, sy / n] : [0, 0];
}

export function distance(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); }
