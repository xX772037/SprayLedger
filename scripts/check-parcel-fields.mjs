// Checks every county parcel layer against the live District III server: that each field SprayLedger asks
// for still exists (one missing field makes the server refuse the whole look-up) and that a small look-up
// returns parcels with owners. Counties rename fields now and then; run this before a release:
//   node scripts/check-parcel-fields.mjs
// Needs internet access; it is not part of npm test.
import { PARCEL_SOURCES, queryParcels, countyLabel } from '../src/parcels.js';

let failed = 0;
for (const s of PARCEL_SOURCES) {
  const label = countyLabel(s.county).padEnd(24);
  try {
    const meta = await (await fetch(`${s.url}?f=json`)).json();
    const have = new Set((meta.fields || []).map(f => f.name.toUpperCase()));
    const missing = [...new Set(Object.values(s.f).flat())].filter(k => !have.has(k.toUpperCase()));
    if (missing.length) { failed++; console.log(`FAIL ${label} missing fields: ${missing.join(', ')}`); continue; }
    const count = await (await fetch(`${s.url}/query?where=1%3D1&returnCountOnly=true&f=json`)).json();
    if (!(count.count > 0)) { failed++; console.log(`FAIL ${label} no parcels (${JSON.stringify(count.error || count)})`); continue; }
    console.log(`ok   ${label} ${count.count} parcels, all ${have.size ? 'requested fields present' : ''}`);
  } catch (e) {
    failed++; console.log(`FAIL ${label} ${e.message}`);
  }
}
// One real look-up through the app's own code, to be sure a query with these fields is accepted.
const r = await queryParcels({ bbox: [44.06, -98.60, 44.10, -98.54] }); // Wessington Springs, Jerauld County
if (!r.parcels.length || r.errors.length) { failed++; console.log('FAIL sample look-up', JSON.stringify(r.errors)); }
else console.log(`ok   sample look-up: ${r.parcels.length} parcels`);
console.log(failed ? `${failed} problem(s)` : 'all counties ok');
process.exit(failed ? 1 : 0);
