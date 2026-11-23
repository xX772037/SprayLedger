# SprayLedger

Application records for spray drone and ground sprayer operators, built from the flight log, the sprayer monitor's log or a live GPS track.

Import a flight log and a field boundary, and SprayLedger works out:

- **Coverage.** A map of the field showing sprayed once, overlap, skipped and off-target areas. Coverage %, overlap and off-target acres. A numbered list of unsprayed patches with GPS coordinates to go back and re-spray.
- **What went on.** Gallons sprayed (integrated from pump flow), the actual gal/ac against target, and the total amount of each product in the tank mix (tank-mix concentration × gallons actually sprayed). Per-flight times and volumes.
- **When.** Date and start and end times from the log, plus the **re-entry time** (longest REI in the mix) and **earliest harvest date** (longest PHI). If any pesticide's REI hasn't been entered, the re-entry time shows as unknown rather than a too-early time.
- **Whether the record is complete.** A checklist of the 11 items South Dakota requires on every application record ([ARSD 12:56:07:01](https://sdlegislature.gov/Rules/Administrative/12:56:07:01)), plus the applicator license number from the state form and the re-entry hours of every pesticide. (The federal restricted-use recordkeeping rule, 7 CFR Part 110, was rescinded by USDA effective July 11, 2025, [90 FR 20083](https://www.federalregister.gov/documents/2025/05/12/2025-08220/rescission-of-recordkeeping-on-restricted-use-pesticides-by-certified-applications).)

On top of that:

- **Map.** The map opens on **Hybrid**: Esri satellite pictures with roads and place names on top, like a hybrid map view. **Satellite** (pictures only) and **Streets** (OpenStreetMap) are one tap away. Coverage is drawn over it: green sprayed, red not sprayed, amber sprayed twice, purple off target, with numbered pins on the patches to re-spray.
  Google's own hybrid pictures are possible later through Google's paid Map Tiles API (API key, billing account, possibly Google's approval for satellite tiles). Copying pictures from Google Earth or Google Maps directly is against Google's terms.
- **Spray conditions.** Wind, gusts, temperature, humidity, Delta T, inversion risk and rain chance at the field, from the Open-Meteo forecast. Each of the next 24 hours is rated go, caution or no-go, and the panel lists the spray windows. Drift direction is shown, and the field edges facing downwind are highlighted on the map. **Fill from weather records** puts the modelled wind, temperature and humidity at the application's start time into the record.
- **Live tracking.** Paints coverage while you spray: the field starts red and turns green under the boom, with speed, GPS accuracy, acres done, acres left and time left. Position comes from:
  - **This device's GPS:** a phone or tablet riding in the cab of a ground rig. Good to roughly 10–15 ft. Tap the big boom button when the sprayer turns on or off (or press the space bar).
  - **USB GPS receiver:** any receiver that outputs standard NMEA 0183 sentences (GGA/RMC), read through Web Serial in Chrome or Edge on a computer. With an RTK receiver, accuracy is about an inch.
  - **Simulated sprayer:** drives a 90 ft boom across the field, for demos.

  A finished live track becomes the record's track like an imported log. Live tracks have no flow data, so enter gallons from the sprayer controller.

- **Land owners (South Dakota).** Parcel lines with owner names on the map for Hutchinson, Hanson, Davison, Douglas, Charles Mix, Bon Homme, Turner and Yankton counties, from the county parcel layers that Planning & Development District III publishes. Tap a parcel to see its owner, parcel number, acreage, legal description and mailing address, and to **use it as the field boundary** (or add it to the field). Once a field is set, the **Land owners** panel shows the field's owner and the owners of land **downwind** within ¼, ½ or 1 mile, with mailing addresses to copy for drift notices. Type an **address** in the box on the map (for example `41255 277th St`) and the app finds the parcel in county records. If the house number isn't on record, it lists the nearest addresses on that road. Picking a parcel fills in the parcel number, land owner and legal description (section-township-range). Parcel number and land owner are saved on the record and in the CSV. McCook County isn't on District III's server (it uses Schneider Beacon).

## Picking equipment and products

- **Plan step: drone or sprayer.** Pick from DJI Agras T100, T70P, T50, T25, XAG P100 Pro, Hylio AG-272 and AG-230, Other drone, or a tractor or ground sprayer (self-propelled, pull-type, 3-point mounted, or other). Every box can be filled in or changed: name for the rig, make and model, serial or FAA registration, working speed, swath or boom width, tank, pump flow and gallons per acre. The plan then shows the spray to mix, tank loads and a rough time for the field, and warns when the pump can't keep up with the rate.
- **My equipment.** Tap **Save as my equipment** to keep a rig's details. Saved rigs appear at the top of the list under *My equipment*, drones first and then ground sprayers, so picking one fills every box. Change a box and tap **Save changes** to update it, or **Save as a new one** to keep both. Saved equipment stays in this browser, like saved jobs.
- **Products step: pick list.** Common herbicides, fungicides, insecticides and adjuvants, plus every product used on your saved jobs. Picking one fills in the trade name, active ingredient, company, EPA Reg. No., restricted-use flag and, where confirmed, the a.i. per unit and REI. Rate and pre-harvest days are never filled from the list because they depend on crop and pest; products from your own jobs bring back your rates.

Specs and label facts live in `src/catalog.js`, each checked against the maker's spec page or the EPA-stamped label in November 2026. Anything that couldn't be confirmed is left blank for the applicator to copy from the label. Edit that file to add the drones and products you use.

## Built for easy reading

The app walks through a job in seven steps (**Field → Plan → Spray → Products → Details → Documents → Invoice**), one screen at a time, each with a "Step 2 of 7" heading and one line saying what to do. It is always white, whatever the phone's dark-mode setting. Jobs save themselves when you move between steps; the practice job never does. Main text is 18px in Atkinson Hyperlegible, a typeface designed for low vision; smaller notes are about 16–17px. Text contrast is 7:1 or better. Buttons and input boxes are 52px tall or more (most are 56px). The **AA** button makes everything bigger, in three sizes.

## Disclaimer and privacy

A **Disclaimer** and **Privacy** link sits at the bottom of every screen (and the welcome page links the disclaimer). In plain language:

- **Disclaimer:** the label is the law; SprayLedger keeps records and is not legal, agronomic or safety advice; coverage, acres, gallons, weather ratings and land records are estimates from GPS, forecasts and county data; no warranty; keep your own copies.
- **Privacy:** jobs, equipment, the logo and settings stay in the browser on the device, with no accounts, analytics or tracking cookies. It names exactly what leaves the device: the map area to Esri and OpenStreetMap, the field location and date to Open-Meteo, the map area and searched addresses to the District III GIS service, and the visit to the site's host. Location is used only for go-to-my-location and live tracking and is never sent anywhere.

These were written for a small software tool, not by a lawyer. Have an attorney review them before charging customers, and update the privacy page whenever a new outside service is added (the list is in `src/config.js` and `src/parcels.js`).

## Invoicing

Step 7, **Invoice**, comes after Documents and opens from any job, including finished ones in My jobs.

- It shows the customer, field, date and acres sprayed (from the coverage map, or the acres typed in on step 5).
- Type **your rate per acre** and, for each product, **what you charge for it**. Both start at $0; leave a product at $0 if the customer supplied it.
- The total adds itself up: **acres × rate per acre + product charges**. Acres are billed to 2 decimals, as printed, so the customer can check the math. Blank or negative amounts count as $0.
- **Download PDF** makes an invoice in the same style as the customer report (on phones, **Text or email it** opens the share menu).
- **Invoice number:** each job gets the next number the first time its invoice is opened: 1001, 1002, and so on, or counting on from your own style (`2026-014` is followed by `2026-015`). Change it any time; the app warns if another job already uses it. The PDF file is named with the number.
- **How customers pay you:** type it once on the Invoice step (for example "Due within 30 days. Checks payable to…"). It prints under *How to pay* and carries over to every new job with your business name and address.
- **Your logo:** add a PNG or JPG once on the Invoice step. It prints at the top right of the invoice and the customer report (not the state record). It's shrunk and trimmed to fit, and kept in this browser on this device.
- The rate, total and number are saved with the job and added to the spreadsheet export as `invoice_rate_per_acre`, `invoice_total` and `invoice_number`.

There are no taxes or discounts yet; add them on the PDF by hand if you need them.

## End-of-job documents (South Dakota)

On the last step, **Documents**, two PDFs with a **Download PDF** button each. On phones, **Send** opens the share menu so the PDF can go by text or email:

- **Customer report:** what was sprayed, the re-entry time and earliest harvest date in a box at the top, rates and totals, weather, the coverage map, and the applicator's contact details. ARSD 12:56:07:04 requires a commercial applicator to give the customer a record on written request.
- **State application record:** laid out and numbered like the S.D. DANR recordkeeping form, covering the 11 items of ARSD 12:56:07:01. Product totals are in gallons or pounds as the form asks, plus the license number, supporting GPS data and a signature line. Records must be complete by the end of the application day and **kept for 3 years**. They are not filed after each job: the department gets a copy on request (ARSD 12:56:07:02–:03).

The record check at the top of the Documents step lists the 11 state items and jumps to whatever is missing. Jobs can also be exported to a spreadsheet (CSV, one row per product).

It opens with a simulated sample job: a 40-acre fungicide application with a clogged nozzle and some GPS drift.

## Data, services and offline use

Records stay in the browser on the device (IndexedDB); the app has no server of its own. It contacts these outside services, and only these:

| Service | Used for | Sent |
| --- | --- | --- |
| Esri World Imagery, OpenStreetMap | map pictures | map tile positions |
| Open-Meteo | forecast and past weather | the field's latitude and longitude |
| Planning & Development District III | county parcel lines, owners, address search | the map area or the address typed |

Fonts, the map library and the PDF maker are stored with the app, so nothing is loaded from Google or a CDN. Once a hosted copy has been opened with signal, the app opens without signal too (`sw.js`; `test/offline.test.js` checks every app file is stored). With no signal:

- an **Offline** badge shows in the top bar;
- the map has no satellite picture and says so, but drawing the field and the coverage map still work on its plain background;
- weather and parcel lookups say they can't load; enter the weather by hand;
- entering a job, live tracking and making the PDFs all work;
- jobs saved while offline are marked **Not synced** in My jobs. There is no cloud backup yet, so every job is kept only on this device and the mark stays; export to a spreadsheet to keep a copy.

## What still needs real-world work

- **Log time zones.** Drone apps write times differently. When a log's times have no time zone they are read as UTC, which most drone apps write, and the Spray step lets the applicator switch to local time. Check a real log from each drone model. KML and GeoJSON tracks with no times are mapped by distance alone, and the start and finish times are typed in by hand.

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

### Drone models

Each maker's app writes its log differently. A maker gets its own import profile (column names, flow unit, spray on/off switch and time format, in `LOG_PROFILES` in `src/parse.js`) only once a **real export file** from that maker's app has been checked; column names are never guessed. When the first maker profile is added, a **Drone model** selector appears above *Choose flight log* on the Spray step; until then every file goes through *Other / generic*.

| Drone | Supported now | What to export | Status |
| --- | --- | --- | --- |
| DJI Agras T100, T70P, T50, T25 | Only if the file has common column names (generic import) | Not confirmed. DJI does not publish an open Agras log format; some third-party services (for example Airdata) offer CSV or KML downloads for some Agras models. | Needs a real export file |
| XAG P100 Pro | Only through the generic KML import, untested with a real XAG file | A KML flight log from the XAG One Management Platform (flight list, then Export Report, then KML), as described by a third party (AcreConnect). | Needs a real export file |
| Hylio AG-272, AG-230 | Only if the file has common column names (generic import) | A report from the Reports tab in AgroSol. Hylio says logs include GPS, altitude, spray rate and speed, but the file layout is not published. | Needs a real export file |
| Any other drone or sprayer monitor | Yes | CSV, KML or GeoJSON with common column names (table above) | Supported |

**Adding a maker:** put a small real export (a few rows, names removed) in `test/fixtures/logs/`, add a profile to `LOG_PROFILES` with that file's column names, and add a test in `test/parse.test.js` that checks time, GPS, flow and spray on/off from the fixture.

Live connections to drones go through each maker's cloud service and are not built yet; import the log after each flight.

## Run it

It is a static site: no build step and nothing to install. `npm start` runs a small web server written with Node's built-in modules (`scripts/serve.mjs`).

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
styles.css        styles (white only)
sw.js             offline copy of the app's own files (on hosted copies)
manifest.webmanifest, icon.svg   lets phones add the app to the home screen
scripts/serve.mjs local web server for `npm start`
vendor/fonts/     Atkinson Hyperlegible (SIL Open Font License), stored with the app
src/parse.js      CSV / KML / GeoJSON importers
src/coverage.js   coverage engine
src/records.js    product math, REI/PHI, compliance check, CSV export
src/store.js      IndexedDB storage
src/map.js        satellite map (Leaflet) and overlays
src/weather.js    forecast, Delta T, inversion risk, go/no-go rating, drift and downwind edges
src/live.js       live tracking: device GPS, USB NMEA receivers, simulation
src/parcels.js    county parcel layers (District III), owner lookup, downwind neighbours
src/catalog.js    drone and ground sprayer starting values, product label facts, job planning math
src/equipment.js  saved equipment profiles (My equipment)
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
