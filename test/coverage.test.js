import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCoverage } from '../src/coverage.js';
import { makeProjection, boundaryArea } from '../src/geo.js';
import { sampleJob } from '../src/sample.js';
import { parseFile } from '../src/parse.js';

const proj = makeProjection(41.9, -93.5);
const LL = (x, y) => proj.toLatLon(x, y);
const square = (s) => [[[LL(0, 0), LL(s, 0), LL(s, s), LL(0, s)]]];

// Serpentine passes across a 100 m square, 1 point per metre, 1 s apart.
function passes(rows, { swath = 10, skipRow = -1, flow = 6 } = {}) {
  const pts = []; let t = 0;
  for (let r = 0; r < rows; r++) {
    const y = swath / 2 + r * swath;
    for (let k = 0; k <= 100; k++) {
      const x = r % 2 ? 100 - k : k;
      const [lat, lon] = LL(x, y);
      const on = r !== skipRow;
      pts.push({ t: (t++) * 1000, lat, lon, flowLpm: on ? flow : 0, spray: on, flight: '1' });
    }
  }
  return pts;
}

test('complete, non-overlapping passes give ~100% coverage and ~no overlap', () => {
  const c = computeCoverage({ points: passes(10), boundary: square(100), swathM: 10, cellM: 0.5 });
  assert.ok(Math.abs(c.stats.fieldM2 - 10000) < 1);
  assert.ok(c.stats.coveragePct > 99.5, `coverage ${c.stats.coveragePct}`);
  assert.ok(c.stats.overlapM2 < 100, `overlap ${c.stats.overlapM2}`);  // only where the turns cross
  // the fixture keeps spraying through 9 turns on the field edge:
  // per turn a 5 × 10 m strip plus two quarter-discs of radius 5 m outside the field ≈ 89.3 m²
  assert.ok(Math.abs(c.stats.offTargetM2 - 9 * (50 + Math.PI * 25 / 2)) < 30, `off-target ${c.stats.offTargetM2}`);
});

test('a skipped pass is reported as a ~1000 m² gap', () => {
  const c = computeCoverage({ points: passes(10, { skipRow: 4 }), boundary: square(100), swathM: 10, cellM: 0.5 });
  assert.ok(Math.abs(c.stats.skippedM2 - 1000) < 60, `skipped ${c.stats.skippedM2}`);
  assert.ok(Math.abs(c.gaps[0].areaM2 - 1000) < 60);
});

test('volume integrates flow over spraying time', () => {
  // 1010 points, 1 s apart, all spraying (turns included) = 1009 s at 6 L/min → 100.9 L
  const c = computeCoverage({ points: passes(10), boundary: square(100), swathM: 10 });
  assert.ok(Math.abs(c.stats.volumeL - 100.9) < 1e-6, `volume ${c.stats.volumeL}`);
});

test('the same run never counts as overlapping itself', () => {
  const pts = [];
  for (let k = 0; k <= 50; k++) { const [lat, lon] = LL(25 + k, 50); pts.push({ t: k * 1000, lat, lon, flowLpm: 5, spray: true, flight: '1' }); }
  const c = computeCoverage({ points: pts, boundary: square(100), swathM: 10, cellM: 0.5 });
  assert.equal(c.stats.overlapM2, 0);
  assert.ok(Math.abs(c.stats.coveredM2 - 500) < 15, `covered ${c.stats.coveredM2}`);
});

test('spraying outside the boundary is off-target', () => {
  const pts = [];
  for (let k = 0; k <= 50; k++) { const [lat, lon] = LL(120 + k, 50); pts.push({ t: k * 1000, lat, lon, flowLpm: 5, spray: true, flight: '1' }); }
  const c = computeCoverage({ points: pts, boundary: square(100), swathM: 10, cellM: 0.5 });
  assert.ok(Math.abs(c.stats.offTargetM2 - 500) < 15);
  assert.equal(c.stats.coveredM2, 0);
});

test('holes are excluded from field area', () => {
  const xy = [[[0, 0], [100, 0], [100, 100], [0, 100]], [[40, 40], [60, 40], [60, 60], [40, 60]]];
  assert.equal(boundaryArea([xy]), 9600);
});

test('sample job analyses to plausible numbers', () => {
  const j = sampleJob();
  const r = parseFile(j.fileName, j.csv);
  const c = computeCoverage({ points: r.points, boundary: j.boundary, swathM: 23 * 0.3048 });
  const ac = c.stats.fieldM2 / 4046.8564224;
  assert.ok(ac > 39 && ac < 42, `field ${ac}`);
  assert.ok(c.stats.coveragePct > 94 && c.stats.coveragePct < 99.5);
  assert.ok(c.gaps.some(g => g.areaM2 > 400 && g.areaM2 < 800), 'the clogged pass shows up as a gap');
  assert.ok(c.flights.length >= 8);
});
