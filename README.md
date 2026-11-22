# SprayLedger

Application records for spray drone operators, built straight from the drone's flight log.

Import a flight log and a field boundary, and SprayLedger works out:

- **Coverage.** A map of the field showing sprayed once, overlap, skipped and off-target areas. Coverage %, overlap and off-target acres. A numbered list of unsprayed patches with GPS coordinates to go back and re-spray.
- **What went on.** Gallons sprayed (integrated from pump flow), the actual gal/ac against target, and the total amount of each product in the tank mix (tank-mix concentration × gallons actually sprayed). Per-flight times and volumes.
- **When.** Date and start and end times from the log, plus the **re-entry time** (longest REI in the mix) and **earliest harvest date** (longest PHI).
- **Whether the record is complete.** A checklist of the items the federal restricted-use pesticide recordkeeping rule ([7 CFR Part 110](https://www.ecfr.gov/current/title-7/subtitle-B/chapter-I/subchapter-B/part-110)) asks for, plus common state extras (times, wind, temperature).

On top of that:

- **Satellite map.** Coverage is drawn over satellite imagery (or street map): green sprayed, red not sprayed, amber sprayed twice, purple off target, with numbered pins on the patches to re-spray.
- **Spray conditions.** Wind, gusts, temperature, humidity, Delta T, inversion risk and rain chance at the field, from the Open-Meteo forecast. Each of the next 24 hours is rated go, caution or no-go, and the panel lists the spray windows. Drift direction is shown, and the field edges facing downwind are highlighted on the map. **Fill from weather records** puts the modelled wind, temperature and humidity at the application's start time into the record.
- **Live tracking.** Paints coverage while you spray: the field starts red and turns green under the boom, with speed, GPS accuracy, acres done, acres left and time left. Position comes from:
  - **This device's GPS:** a phone or tablet riding in the cab of a ground rig. Good to roughly 10–15 ft. Tap the big boom button when the sprayer turns on or off (or press the space bar).
  - **USB GPS receiver:** any receiver that outputs standard NMEA 0183 sentences (GGA/RMC), read through Web Serial in Chrome or Edge on a computer. With an RTK receiver, accuracy is about an inch.
  - **Simulated sprayer:** drives a 90 ft boom across the field, for demos.

  A finished live track becomes the record's track like an imported log. Live tracks have no flow data, so enter gallons from the sprayer controller.

- **Land owners (South Dakota).** Parcel lines with owner names on the map for Hutchinson, Hanson, Davison, Douglas, Charles Mix, Bon Homme, Turner and Yankton counties, from the county parcel layers that Planning & Development District III publishes. Tap a parcel to see its owner, parcel number, acreage, legal description and mailing address, and to **use it as the field boundary** (or add it to the field). Once a field is set, the **Land owners** panel shows the field's owner and the owners of land **downwind** within ¼, ½ or 1 mile, with mailing addresses to copy for drift notices. Type an **address** in the box on the map (for example `41255 277th St`) and the app finds the parcel in county records. If the house number isn't on record, it lists the nearest addresses on that road. Picking a parcel fills in the parcel number, land owner and legal description (section-township-range). Parcel number and land owner are saved on the record and in the CSV. McCook County isn't on District III's server (it uses Schneider Beacon).

## Picking equipment and products

- **Plan step: drone or sprayer.** Pick from DJI Agras T100, T70P, T50, T25, XAG P100 Pro, Hylio AG-272 and AG-230, or choose Ground sprayer or Other. The tank size, pump flow and a starting swath fill in, and any of them can be changed. The plan then shows the spray to mix, tank loads and a rough time for the field, and warns when the pump can't keep up with the rate.
- **Products step: pick list.** Common herbicides, fungicides, insecticides and adjuvants, plus every product used on your saved jobs. Picking one fills in the trade name, active ingredient, company, EPA Reg. No., restricted-use flag and, where confirmed, the a.i. per unit and REI. Rate and pre-harvest days are never filled from the list because they depend on crop and pest; products from your own jobs bring back your rates.

Specs and label facts live in `src/catalog.js`, each checked against the maker's spec page or the EPA-stamped label in November 2026. Anything that couldn't be confirmed is left blank for the applicator to copy from the label. Edit that file to add the drones and products you use.

## Built for easy reading

The app walks through a job in five steps (**Field → Weather → Spray → Products → Finish**), one screen at a time. Text is at least 18px in Atkinson Hyperlegible, a typeface designed for low vision, with contrast of 7:1 or better. Buttons are at least 56px tall. The **AA** button makes everything bigger, in three sizes.

## End-of-job documents (South Dakota)

On the Finish step, two PDFs. On phones, **Send** opens the share menu so the PDF can go by text or email:

- **Customer report:** what was sprayed, the re-entry time and earliest harvest date in a box at the top, rates and totals, weather, the coverage map, and the applicator's contact details. ARSD 12:56:07:04 requires a commercial applicator to give the customer a record on written request.
- **State application record:** laid out and numbered like the S.D. DANR recordkeeping form, covering the 11 items of ARSD 12:56:07:01. Product totals are in gallons or pounds as the form asks, plus the license number, supporting GPS data and a signature line. Records must be complete by the end of the application day and **kept for 3 years**. They are not filed after each job: the department gets a copy on request (ARSD 12:56:07:02–:03).

The **Record check** on the Finish step lists the 11 state items and jumps to whatever is missing. Jobs can also be exported to a spreadsheet (CSV, one row per product).

It opens with a simulated sample job: a 40-acre fungicide application with a clogged nozzle and some GPS drift.

## What still needs real-world work

- **Drone live telemetry.** Drones are covered by importing their flight log after each flight. Live drone position needs each manufacturer's cloud or SDK integration (for example a DJI Cloud API partnership, or MAVLink for ArduPilot/PX4-based sprayers).
- **Boom on/off from the sprayer.** In the cab the operator taps the boom button. Reading boom state automatically needs a connection to the rate controller or ISOBUS.
- **Real log files.** The importers are generic; test with real exports from the drones your customers fly.
- **Parcel data terms.** District III's services carry no license text. Before charging customers for the owner lookup, get District III's written OK (Planning & Development District III, 1808 Summit St, Yankton). Owner data is public record but can lag recent sales.
- **Service plans.** The satellite imagery (Esri) and weather (Open-Meteo) used here are free for non-commercial use. For a paid product, switch to keyed commercial plans in `src/config.js`.

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
npm test       # 50 unit tests (parsers, coverage engine, product math, SD record check, CSV, weather rules, NMEA, parcels, address search, catalog and job plan)
```

### Put it online (GitHub Pages)

`.github/workflows/pages.yml` publishes the app on every push to `main`. One-time setup: in the repository, open **Settings → Pages**, and under **Build and deployment** set **Source** to **GitHub Actions**. The app then lives at `https://<your-user>.github.io/<repo>/`. It needs HTTPS for phone GPS, so use that address rather than opening the file directly.

Any other static host works too (Netlify, Cloudflare Pages). Records are stored in the browser (IndexedDB) on that device.

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
src/map.js        satellite map (Leaflet) and overlays
src/weather.js    forecast, Delta T, inversion risk, go/no-go rating, drift and downwind edges
src/live.js       live tracking: device GPS, USB NMEA receivers, simulation
src/parcels.js    county parcel layers (District III), owner lookup, downwind neighbours
src/catalog.js    drone specs, product label facts, job planning math
src/config.js     map imagery, weather service and spray limits
src/docs.js       customer report and SD application record (PDF)
vendor/leaflet/   Leaflet 1.9.4 (BSD-2-Clause)
vendor/jspdf/     jsPDF 2.5.1 (MIT)
src/sample.js     simulated sample job
src/app.js        UI
test/             node:test unit tests
```

## Next steps toward a paid product

- Accounts and cloud sync, so records are shared across devices and with customers.
- Direct imports from specific drone makers' cloud services and file formats.
- State-specific report templates.
