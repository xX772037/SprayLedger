Title: Invoicing, offline mode, drone log profiles, disclaimer and privacy

## What's in this

**Invoicing (step 7)**
- Rate per acre plus a charge per product. The total updates as you type: acres × rate + product charges. Acres are billed to 2 decimals, as printed, so the math checks out.
- Invoice number, auto-numbered and editable (1001, 1002… or your own style), with a warning when a number is already used on another job.
- Payment instructions, typed once and carried to new jobs.
- Business logo, uploaded once, printed on the invoice and the customer report.
- Download a one-page PDF, or text or email it on phones.
- The spreadsheet export gains `invoice_rate_per_acre`, `invoice_total` and `invoice_number`.

**Offline mode**
- Fixes the offline file list: `src/equipment.js` and the Leaflet marker images were missing, so the app would not open with no signal. A test now fails if any app file is left out.
- An Offline badge in the top bar.
- With no satellite picture, the map says so; drawing the field and the coverage still work on a plain background.
- Jobs saved offline are marked "Not synced". There is no cloud backup yet, and the app says so.

**Drone log profiles**
- A mapping system so each maker can have its own columns, units, spray on/off switch and time format, plus a Drone model picker that stays hidden until a maker is added.
- **No maker is added**: no real DJI Agras, XAG or Hylio export file was available, and column names are not guessed.

**Disclaimer and privacy**
- Plain-language pages linked from a footer on every screen.
- The privacy page names each outside service and exactly what it receives. This was checked against the code.
- Written without a lawyer: have an attorney review before charging customers.

**Fixes from the pre-merge check**
- Saving or making a PDF within 300 ms of a swath change stored stale acres (about 22% low). Saves, PDFs and step changes now recalculate first.
- An invoice could show a negative total or "$-0.00". It now never shows negative, NaN or blank.
- The practice log is renamed from `sample-agras-flight…` so it doesn't suggest DJI support.

## Testing
- `npm test`: 118 passed, 0 failed, 0 skipped.
- `npm run test:e2e`: 16 passed, 0 failed, 0 skipped.
- A click-through check of every button: 27 of 27 passed.
- Upgrade check: jobs saved by the first release (database v1) and by current main (v2) open in this version (v3) with nothing lost. They walk all seven steps and make all three PDFs. Both records are kept as test fixtures.
- spray_rate regression: `spray-rate-log.csv` and a control log of the same flight both give 0.531 acres and 1.367 gal.

## Before merging
- **Real-phone offline check** (iPhone and Android): the steps are in the pre-merge report. On iPhone this can only be done on the live site after merging.
- Satellite maps, weather and county land records were only checked for their "can't load" messages, because they were blocked in the test environment.
