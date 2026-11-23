import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNMEA, nmeaAccuracyM, LiveSession } from '../src/live.js';

test('GGA sentence with checksum', () => {
  const s = parseNMEA('$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47');
  assert.equal(s.type, 'GGA'); assert.equal(s.fix, 1); assert.equal(s.sats, 8);
  assert.ok(Math.abs(s.lat - 48.1173) < 1e-4); assert.ok(Math.abs(s.lon - 11.516667) < 1e-5);
  assert.ok(Math.abs(nmeaAccuracyM(s) - 2.7) < 1e-9);
});

test('RMC sentence gives speed and course; bad checksum is rejected', () => {
  const s = parseNMEA('$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A');
  assert.equal(s.valid, true); assert.ok(Math.abs(s.speedMps - 11.5235) < 1e-3); assert.equal(s.course, 84.4);
  assert.equal(parseNMEA('$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*00'), null);
});

test('RTK fix quality and southern/western hemispheres', () => {
  const s = parseNMEA('$GNGGA,000000,3346.000,S,05830.000,W,4,20,0.6,30,M,0,M,,');
  assert.equal(s.rtk, 'fixed'); assert.equal(nmeaAccuracyM(s), 0.03);
  assert.ok(s.lat < 0 && s.lon < 0);
});

test('session drops inaccurate fixes and duplicate standing-still points', () => {
  const ses = new LiveSession({ maxAccuracyM: 10 });
  assert.equal(ses.add({ t: 0, lat: 41.9, lon: -93.6, accuracyM: 30 }), false);
  assert.equal(ses.add({ t: 1, lat: 41.9, lon: -93.6, accuracyM: 4 }), true);
  assert.equal(ses.add({ t: 2, lat: 41.9, lon: -93.6, accuracyM: 4 }), false);
  ses.spray = true;
  assert.equal(ses.add({ t: 3, lat: 41.9, lon: -93.6, accuracyM: 4 }), true); // boom switched on
  assert.equal(ses.points[1].spray, true);
  assert.equal(ses.rejected, 1);
});
