// Generates a realistic example job so the app opens with something to look at:
// a ~40 acre field with a pond, sprayed by a 40 L drone at 2 gal/ac over several tank loads,
// with one partially clogged pass (a skip) and some GPS drift (overlap). Deterministic.

import { makeProjection, pointInRing, L_PER_GAL, M2_PER_ACRE } from './geo.js';

function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const ORIGIN = [44.2953, -96.9017]; // farmland in Brookings County, SD (outside the counties with parcel data, so no real owners show)
const FIELD = [[0, 0], [420, -6], [436, 170], [404, 392], [12, 384], [-14, 196]];
const POND = Array.from({ length: 10 }, (_, i) => { const a = (i / 10) * Math.PI * 2; return [300 + 34 * Math.cos(a), 250 + 26 * Math.sin(a)]; });

export function sampleJob() {
  const rand = rng(20260614);
  const proj = makeProjection(...ORIGIN);
  const ll = ([x, y]) => proj.toLatLon(x, y);

  const swath = 7.0, spacing = 6.7, speed = 6.0, tankL = 40;
  const targetGpa = 2;
  const flowLpm = (targetGpa * L_PER_GAL) * (swath * speed * 60) / M2_PER_ACRE; // L/min for 2 gal/ac
  const home = [-40, -30];
  const start = new Date('2026-06-14T06:42:00');

  const rows = [];
  let t = start.getTime(), flight = 1, tank = tankL;
  let pos = [...home];

  const emit = (x, y, spray, spd, f) => {
    const jx = (rand() - 0.5) * 0.6, jy = (rand() - 0.5) * 0.6;
    const [lat, lon] = proj.toLatLon(x + jx, y + jy);
    rows.push([new Date(t).toISOString().slice(0, 19), lat.toFixed(7), lon.toFixed(7), (spray ? 3 + rand() * 0.3 : 8).toFixed(1), spd.toFixed(1), (spray ? f : 0).toFixed(2), spray ? 1 : 0, flight]);
  };
  const flyTo = (tx, ty) => {
    const v = 9;
    for (;;) {
      const dx = tx - pos[0], dy = ty - pos[1], d = Math.hypot(dx, dy);
      if (d < v) { pos = [tx, ty]; break; }
      pos = [pos[0] + (dx / d) * v, pos[1] + (dy / d) * v];
      t += 1000; emit(pos[0], pos[1], false, v, 0);
    }
  };
  const refill = () => {
    flyTo(...home);
    t += 1000; emit(home[0], home[1], false, 0, 0);
    t += (200 + rand() * 90) * 1000; // land, swap battery, refill tank
    flight++; tank = tankL;
    t += 1000; emit(home[0], home[1], false, 0, 0);
  };

  const inside = (x, y) => pointInRing(x, y, FIELD) && !pointInRing(x, y, POND);
  let dir = 1, pass = 0;
  for (let y = spacing / 2; y < 392; y += spacing, pass++) {
    const drift = pass === 31 ? 2.6 : 0;        // GPS drift on one pass → extra overlap
    const clogFrom = pass === 18 ? 150 : null;  // nozzle clog for 90 m → a skip
    const yy = y + drift;
    // where this pass enters and leaves the field
    let first = null, lastIn = null;
    for (let x = -30; x <= 460; x += 1) if (inside(x, yy)) { first ??= x; lastIn = x; }
    if (first === null) { dir = -dir; continue; }
    const [x0, x1] = dir > 0 ? [first, lastIn] : [lastIn, first];
    const step = speed * dir;
    flyTo(x0 - step, yy);
    for (let x = x0; dir > 0 ? x <= x1 + step : x >= x1 + step; x += step) {
      if (tank <= 0.2) { refill(); flyTo(x - step, yy); }
      const on = inside(x, yy) && !(clogFrom !== null && x > clogFrom && x < clogFrom + 90);
      const f = on ? flowLpm * (1 + (rand() - 0.5) * 0.06) : 0;
      pos = [x, yy]; t += 1000;
      emit(x, yy, on, speed, f);
      tank -= f / 60;
    }
    dir = -dir;
  }
  flyTo(...home); t += 1000; emit(home[0], home[1], false, 0, 0);

  const csv = ['timestamp,latitude,longitude,altitude_m,speed_mps,flow_l_min,spraying,flight', ...rows.map(r => r.join(','))].join('\n');
  const boundary = [[FIELD.map(ll), POND.map(ll)]];

  return {
    csv,
    fileName: 'sample-flight-log-2026-06-14.csv',
    boundary,
    record: {
      job: {
        farm: 'Example: Lindqvist Farms', customerAddress: 'Example address, Brookings SD 57006', field: 'North 40',
        legal: 'Example: NE¼ 6-110-50', crop: 'Soybeans', pest: 'Frogeye leaf spot',
      },
      applicator: { name: 'Example Applicator', cert: 'AP-00000', company: 'Example Aerial Spraying', phone: '(605) 555-0100', address: 'Example address, Volga SD' },
      equipment: { model: 'dji-t50', drone: 'DJI Agras T50 (practice)', serial: 'FA-EXAMPLE', swathFt: 23, targetGpa, tankGal: 10.6, flowGpm: 4.2 },
      products: [
        { name: 'Example fungicide (sample)', common: 'example active ingredient', company: 'Example Chemical Co.', epa: '00000-000', ai: '2.09 lb per gal', rate: '8', unit: 'fl oz', rei: '12', phi: '21' },
        { name: 'Example adjuvant (sample)', common: 'non-ionic surfactant', company: 'Example Adjuvants Inc.', epa: '', ai: '90%', rate: '0.25', unit: 'pt', rei: '', phi: '' },
      ],
      conditions: { wind: '6', windDir: 'SW', temp: '68', humidity: '74', source: 'Measured on site (example)' },
      notes: 'Sample data for demonstration. Nozzle clogged mid-pass during flight 3, cleared at refill. GPS drift on one pass in flight 5.',
    },
  };
}
