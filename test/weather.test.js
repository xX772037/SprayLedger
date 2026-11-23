import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wetBulbC, deltaTF, assessHour, parseForecast, sprayWindows, downwindEdges, compass8, fetchConditionsAt } from '../src/weather.js';

test('wet bulb matches Stull (2011): 20 °C at 50% RH ≈ 13.7 °C', () => {
  assert.ok(Math.abs(wetBulbC(20, 50) - 13.7) < 0.1);
});

test('Delta T in °F', () => {
  // 68 °F / 50% → (20 - 13.7) °C ≈ 6.3 °C ≈ 11.3 °F
  assert.ok(Math.abs(deltaTF(68, 50) - 11.3) < 0.3);
});

const base = { temp: 70, rh: 65, wind: 6, gust: 9, dir: 225, t80: 68, precip: 0, rainSoon: 0 };

test('good conditions are a go', () => {
  const r = assessHour(base);
  assert.equal(r.status, 'go', JSON.stringify(r.reasons));
});

test('high wind, gusts, inversion, dry air and rain are flagged', () => {
  assert.equal(assessHour({ ...base, wind: 14 }).status, 'no');
  assert.equal(assessHour({ ...base, wind: 9 }).status, 'caution');
  assert.equal(assessHour({ ...base, gust: 18 }).status, 'caution');
  const inv = assessHour({ ...base, wind: 2, t80: 74 });
  assert.equal(inv.status, 'no'); assert.ok(inv.inversion);
  assert.match(inv.reasons[0].text, /inversion/);
  assert.equal(assessHour({ ...base, temp: 95, rh: 15 }).status, 'no');
  assert.equal(assessHour({ ...base, precip: 0.05 }).status, 'no');
  assert.equal(assessHour({ ...base, rainSoon: 60 }).status, 'caution');
});

function fakeForecast() {
  const time = [], mk = v => Array(6).fill(v);
  for (let h = 6; h < 12; h++) time.push(`2026-06-14T${String(h).padStart(2, '0')}:00`);
  return {
    utc_offset_seconds: -5 * 3600,
    hourly: {
      time,
      temperature_2m: [62, 64, 68, 72, 75, 78], relative_humidity_2m: [90, 80, 65, 55, 50, 45],
      wind_speed_10m: [2, 4, 6, 7, 12, 13], wind_gusts_10m: [3, 6, 9, 10, 18, 20], wind_direction_10m: mk(225),
      temperature_80m: [66, 64, 66, 70, 73, 76], precipitation: mk(0), precipitation_probability: mk(5),
    },
  };
}

test('forecast parses to UTC timestamps and finds spray windows', () => {
  const hours = parseForecast(fakeForecast());
  assert.equal(hours.length, 6);
  assert.equal(hours[0].t, Date.UTC(2026, 5, 14, 11)); // 06:00 at UTC-5
  assert.deepEqual(hours.map(h => h.status), ['no', 'go', 'go', 'go', 'no', 'no']);
  const w = sprayWindows(hours);
  assert.equal(w.length, 1);
  assert.equal(w[0].start, Date.UTC(2026, 5, 14, 12));
  assert.equal(w[0].end, Date.UTC(2026, 5, 14, 15));
});

test('downwind edges: wind from the west makes the east edge downwind', () => {
  const sq = [[[0, 0], [100, 0], [100, 100], [0, 100]]];
  const r = downwindEdges([sq], 270);
  assert.equal(r.towardDeg, 90);
  assert.deepEqual(r.edges, [[[100, 0], [100, 100]]]);
  // same answer for a clockwise ring
  const cw = [[[0, 0], [0, 100], [100, 100], [100, 0]]];
  assert.deepEqual(downwindEdges([cw], 270).edges, [[[100, 100], [100, 0]]]);
});

test('compass names', () => {
  assert.equal(compass8(225), 'SW'); assert.equal(compass8(359), 'N'); assert.equal(compass8(-90), 'W');
});

test('conditions at a past time pick the nearest hour', async () => {
  const fetchImpl = async url => { assert.match(url, /start_date=/); return { ok: true, json: async () => fakeForecast() }; };
  const c = await fetchConditionsAt(41.9, -93.6, Date.UTC(2026, 5, 14, 13, 20), { fetchImpl });
  assert.deepEqual([c.wind, c.windDir, c.temp, c.humidity], ['6', 'SW', '68', '65']);
});

test('network failure gives a readable error', async () => {
  await assert.rejects(fetchConditionsAt(41.9, -93.6, Date.now(), { fetchImpl: async () => { throw new TypeError('blocked'); } }), /unreachable/);
});
