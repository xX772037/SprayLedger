# SprayLedger

Application records for spray drone operators, built straight from the drone's flight log.

Import a flight log and a field boundary, and SprayLedger works out:

- **Coverage.** A map of the field showing sprayed once, overlap, skipped and off-target areas. Coverage %, overlap and off-target acres. A numbered list of unsprayed patches with GPS coordinates to go back and re-spray.
- **What went on.** Gallons sprayed (integrated from pump flow), the actual gal/ac against target, and the total amount of each product in the tank mix (tank-mix concentration × gallons actually sprayed). Per-flight times and volumes.
- **When.** Date and start and end times from the log, plus the **re-entry time** (longest REI in the mix) and **earliest harvest date** (longest PHI).
- **Whether the record is complete.** A checklist of the items the federal restricted-use pesticide recordkeeping rule ([7 CFR Part 110](https://www.ecfr.gov/current/title-7/subtitle-B/chapter-I/subchapter-B/part-110)) asks for, plus common state extras (times, wind, temperature).

Records can be saved, exported as CSV (one row per product, ready for a spreadsheet or a customer), and printed as a one-page application report with the coverage map and a signature line.

It opens with a simulated sample job: a 40-acre fungicide application with a clogged nozzle and some GPS drift.

## Supported files

| File | What is read |
| --- | --- |
| CSV flight log | Time, latitude, longitude, flow rate (L/min, gal/min or mL/min, detected from the header), spray on/off, flight or sortie number, altitude, speed. Column names are matched by common synonyms (`lat`/`latitude`/`gps_lat`, `flow_rate`/`flow_l_min`/`flow_gpm`, `spraying`/`pump_on`, ...). Without a spray column, spraying is inferred from flow. Without a flight column, flights split at gaps over 60 s. |
| KML | Field polygons (including holes for ponds and waterways), `LineString` and `gx:Track` flight paths. |
| GeoJSON | `Polygon`/`MultiPolygon` boundaries, `LineString` tracks (with `coordTimes`), or `Point` features with `time`, `flow` and `spraying` properties. |

No boundary file? Use **Draw boundary** and click the field corners on the map.

> Drone makers export logs differently, and live connections go through each maker's cloud service. The importers here are generic. Before selling to operators of a particular drone, test with that drone's real export files and add any column names it uses to `COLS` in `src/parse.js`.

## Run it

It is a static site with no build step and no dependencies.

```sh
npm start      # serves on http://localhost:8080
npm test       # 20 unit tests (parsers, coverage engine, product math, compliance, CSV)
```

Any static host works (GitHub Pages, Netlify, Cloudflare Pages). Records are stored in the browser (IndexedDB) on that device.

## How coverage is computed

`src/coverage.js` projects the GPS track to metres around the field and rasterises it onto a 1 m grid. Each continuous spraying run is stamped as a swath-wide band, with round joints and flat ends where the spray switched on or off. A cell counts an extra pass only when a different run covers it, so consecutive log points never count as overlap. The field mask is a scanline fill of the boundary (holes excluded). Unsprayed areas inside the field are grouped into connected patches.

## Layout

```
index.html        app shell
styles.css        styles (light and dark)
src/parse.js      CSV / KML / GeoJSON importers
src/coverage.js   coverage engine
src/records.js    product math, REI/PHI, compliance check, CSV export
src/store.js      IndexedDB storage
src/sample.js     simulated sample job
src/app.js        UI
test/             node:test unit tests
```

## Next steps toward a paid product

- Accounts and cloud sync, so records are shared across devices and with customers.
- Direct imports from specific drone makers' cloud services and file formats.
- Weather auto-filled from the job location and time.
- Satellite imagery under the coverage map.
- State-specific report templates.
