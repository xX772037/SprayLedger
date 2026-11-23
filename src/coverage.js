// Coverage engine: rasterises the drone's spray swath over a grid and compares it with the field boundary.
//
// Each continuous spraying run is stamped as a chain of capsules (swath-wide), with flat ends where the
// spray switches on or off. A cell counts one more pass only when a *different* run covers it, so the
// joints between segments of the same run are not mistaken for overlap.

import { makeProjection, boundaryArea, centroidLatLon, M2_PER_ACRE } from './geo.js';

const MAX_CELLS = 6_000_000;

export function computeCoverage({ points, boundary = [], swathM, cellM = 1, maxGapS = 10, maxJumpM = 80, minGapM2 = 20 }) {
  if (!points.length) throw new Error('No flight points to analyse.');
  const [lat0, lon0] = centroidLatLon(boundary, points);
  const proj = makeProjection(lat0, lon0);

  const pts = points.map(p => { const [x, y] = proj.toXY(p.lat, p.lon); return { ...p, x, y }; });
  const polys = boundary.map(poly => poly.map(ring => ring.map(([la, lo]) => proj.toXY(la, lo))));
  const hasBoundary = polys.length > 0;

  // Spraying segments, grouped into runs.
  const segs = [];
  let run = 0;
  const dropped = { gaps: 0, jumps: 0, metres: 0 };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const bothSpraying = a.spray && b.spray && a.flight === b.flight;
    const ok = bothSpraying && (b.t - a.t) <= maxGapS * 1000 && len <= maxJumpM;
    // Spraying at both ends but too far apart in time or space to trust: left out, and reported.
    if (bothSpraying && !ok) { if (len > maxJumpM) dropped.jumps++; else dropped.gaps++; dropped.metres += len; }
    if (ok) {
      const prev = segs[segs.length - 1];
      if (!prev || prev.i !== i - 1) run++;
      segs.push({ i, a, b, run });
    }
  }
  // Round joints inside a run, but nothing beyond the planes where spraying switched on and off.
  const runs = new Map();
  for (const s of segs) {
    let r = runs.get(s.run);
    if (!r) { r = { first: s, last: s }; runs.set(s.run, r); }
    r.last = s;
  }
  const unit = (dx, dy) => { const l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
  // Path distance from each segment to its run's start and end (the clip only applies near those ends).
  let acc = 0;
  segs.forEach((s, k) => {
    if (k === 0 || segs[k - 1].run !== s.run) acc = 0;
    s.d0 = acc; acc += Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
  });
  for (let k = segs.length - 1; k >= 0; k--) {
    const s = segs[k];
    if (k === segs.length - 1 || segs[k + 1].run !== s.run) acc = 0;
    s.d1 = acc; acc += Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
  }
  segs.forEach((s, k) => {
    s.capStart = k > 0 && segs[k - 1].run === s.run;
    s.capEnd = k < segs.length - 1 && segs[k + 1].run === s.run;
    const r = runs.get(s.run);
    s.sx = r.first.a.x; s.sy = r.first.a.y; [s.sdx, s.sdy] = unit(r.first.b.x - r.first.a.x, r.first.b.y - r.first.a.y);
    s.ex = r.last.b.x; s.ey = r.last.b.y; [s.edx, s.edy] = unit(r.last.b.x - r.last.a.x, r.last.b.y - r.last.a.y);
  });

  // Grid extent covers the field and everything sprayed.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x, y, r = 0) => { minX = Math.min(minX, x - r); minY = Math.min(minY, y - r); maxX = Math.max(maxX, x + r); maxY = Math.max(maxY, y + r); };
  polys.forEach(p => p[0].forEach(([x, y]) => grow(x, y)));
  segs.forEach(s => { grow(s.a.x, s.a.y, swathM); grow(s.b.x, s.b.y, swathM); });
  if (!Number.isFinite(minX)) pts.forEach(p => grow(p.x, p.y, swathM));
  minX -= 2 * cellM; minY -= 2 * cellM; maxX += 2 * cellM; maxY += 2 * cellM;
  while (((maxX - minX) / cellM) * ((maxY - minY) / cellM) > MAX_CELLS) cellM *= 1.5;
  const W = Math.ceil((maxX - minX) / cellM), H = Math.ceil((maxY - minY) / cellM);
  const N = W * H, cellA = cellM * cellM;

  // Field mask by scanline even-odd fill (handles holes such as ponds and waterways).
  const inField = new Uint8Array(N);
  if (hasBoundary) {
    const edges = [];
    polys.forEach(p => p.forEach(ring => ring.forEach((pt, i) => edges.push([pt, ring[(i + 1) % ring.length]]))));
    for (let j = 0; j < H; j++) {
      const y = minY + (j + 0.5) * cellM;
      const xs = [];
      for (const [[x1, y1], [x2, y2]] of edges) {
        if ((y1 > y) !== (y2 > y)) xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - minX) / cellM - 0.5));
        const i1 = Math.min(W - 1, Math.floor((xs[k + 1] - minX) / cellM - 0.5));
        inField.fill(1, j * W + i0, j * W + i1 + 1);
      }
    }
  }

  // Stamp swaths.
  const count = new Uint8Array(N);
  const last = new Int32Array(N).fill(-1);
  const half = swathM / 2, half2 = half * half;
  for (const s of segs) {
    const { a, b } = s;
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
    const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - half - minX) / cellM));
    const i1 = Math.min(W - 1, Math.ceil((Math.max(a.x, b.x) + half - minX) / cellM));
    const j0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - half - minY) / cellM));
    const j1 = Math.min(H - 1, Math.ceil((Math.max(a.y, b.y) + half - minY) / cellM));
    for (let j = j0; j <= j1; j++) {
      const py = minY + (j + 0.5) * cellM - a.y;
      for (let i = i0; i <= i1; i++) {
        const px = minX + (i + 0.5) * cellM - a.x;
        let d2;
        const t = L2 > 0 ? (px * dx + py * dy) / L2 : 0;
        if (t < 0) { if (!s.capStart) continue; d2 = px * px + py * py; }
        else if (t > 1) { if (!s.capEnd) continue; const qx = px - dx, qy = py - dy; d2 = qx * qx + qy * qy; }
        else { const qx = px - t * dx, qy = py - t * dy; d2 = qx * qx + qy * qy; }
        if (d2 > half2) continue;
        if (t < 0 || t > 1) {
          const wx = px + a.x, wy = py + a.y;
          if (s.d0 < swathM && (wx - s.sx) * s.sdx + (wy - s.sy) * s.sdy < 0) continue;
          if (s.d1 < swathM && (wx - s.ex) * s.edx + (wy - s.ey) * s.edy > 0) continue;
        }
        const c = j * W + i;
        if (last[c] !== s.run) { last[c] = s.run; if (count[c] < 255) count[c]++; }
      }
    }
  }

  // Tally.
  let fieldCells = 0, covered = 0, overlap = 0, skipped = 0, offTarget = 0, sprayedCells = 0;
  for (let c = 0; c < N; c++) {
    const n = count[c];
    if (n) sprayedCells++;
    if (inField[c]) {
      fieldCells++;
      if (n === 0) skipped++; else { covered++; if (n > 1) overlap++; }
    } else if (n) offTarget++;
  }

  // Skips: connected unsprayed areas inside the field, largest first.
  const gaps = [];
  if (hasBoundary) {
    const seen = new Uint8Array(N);
    const stack = [];
    for (let c0 = 0; c0 < N; c0++) {
      if (!inField[c0] || count[c0] || seen[c0]) continue;
      let n = 0, sx = 0, sy = 0;
      stack.push(c0); seen[c0] = 1;
      while (stack.length) {
        const c = stack.pop(); n++;
        const i = c % W, j = (c - i) / W;
        sx += i; sy += j;
        const nb = [i > 0 ? c - 1 : -1, i < W - 1 ? c + 1 : -1, j > 0 ? c - W : -1, j < H - 1 ? c + W : -1];
        for (const d of nb) if (d >= 0 && inField[d] && !count[d] && !seen[d]) { seen[d] = 1; stack.push(d); }
      }
      if (n * cellA >= minGapM2) {
        const x = minX + (sx / n + 0.5) * cellM, y = minY + (sy / n + 0.5) * cellM;
        const [lat, lon] = proj.toLatLon(x, y);
        gaps.push({ areaM2: n * cellA, x, y, lat, lon });
      }
    }
    gaps.sort((a, b) => b.areaM2 - a.areaM2);
  }

  // Volume: trapezoidal integration of flow while spraying.
  let volumeL = 0, sprayMs = 0;
  const hasFlow = pts.some(p => Number.isFinite(p.flowLpm));
  const flights = new Map();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    let f = flights.get(p.flight);
    if (!f) { f = { id: p.flight, start: p.t, end: p.t, sprayStart: null, sprayEnd: null, volumeL: 0, points: 0 }; flights.set(p.flight, f); }
    f.end = p.t; f.points++;
    const q = pts[i + 1];
    if (p.spray) { f.sprayStart ??= p.t; f.sprayEnd = p.t; }
    if (q && q.flight === p.flight && p.spray && q.spray && q.t - p.t <= maxGapS * 1000) {
      const dt = (q.t - p.t) / 60000;
      sprayMs += q.t - p.t;
      if (Number.isFinite(p.flowLpm) && Number.isFinite(q.flowLpm)) {
        const v = ((p.flowLpm + q.flowLpm) / 2) * dt;
        volumeL += v; f.volumeL += v;
      }
    }
  }
  let firstSpray = Infinity, lastSpray = -Infinity;
  for (const p of pts) if (p.spray) { if (p.t < firstSpray) firstSpray = p.t; if (p.t > lastSpray) lastSpray = p.t; }

  const fieldM2 = hasBoundary ? boundaryArea(polys) : sprayedCells * cellA;
  return {
    proj,
    grid: { W, H, cellM, minX, minY, count, inField },
    polys,
    track: pts.map(p => [p.x, p.y, p.spray ? 1 : 0, p.flight]),
    gaps,
    flights: [...flights.values()],
    hasBoundary,
    hasFlow,
    start: Number.isFinite(firstSpray) ? firstSpray : pts[0].t,
    end: Number.isFinite(lastSpray) ? lastSpray : pts[pts.length - 1].t,
    stats: {
      fieldM2,
      fieldRasterM2: fieldCells * cellA,
      coveredM2: hasBoundary ? covered * cellA : sprayedCells * cellA,
      overlapM2: overlap * cellA,
      skippedM2: skipped * cellA,
      offTargetM2: offTarget * cellA,
      sprayedM2: sprayedCells * cellA,
      coveragePct: hasBoundary && fieldCells ? (100 * covered) / fieldCells : null,
      overlapPct: hasBoundary && fieldCells ? (100 * overlap) / fieldCells : null,
      volumeL: hasFlow ? volumeL : null,
      sprayMinutes: sprayMs / 60000,
      dropped,
    },
  };
}

export const acres = m2 => m2 / M2_PER_ACRE;
