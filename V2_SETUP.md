# PRS.AssetVerify 2.0 deployment

Do not replace or edit the existing V12 Worker, V12 database, V12 R2 bucket or current `PRS` GitHub Pages deployment.

## 1. Create new Cloudflare resources

Create a new D1 database named:

`pv-capture-db-v2`

Create a new R2 bucket named:

`pv-capture-photos-v2`

Create a new Worker named:

`pv-capture-ai-v2`

In the new Worker add these bindings:

- D1 binding name `DB` -> `pv-capture-db-v2`
- R2 binding name `Photos` -> `pv-capture-photos-v2`
- Secret `OPENAI_API_KEY` -> your existing OpenAI API key may be reused

Paste the complete `cloudflare-worker/worker.js` into the new Worker and deploy it.

Expected health URL:

`https://pv-capture-ai-v2.mahipal-office21.workers.dev`

Expected health response includes:

- `service: PRS.AssetVerify 2.0`
- `version: 2.0`
- `cleanV20Schema: true`
- `iosGpsWarmup: true`
- `historicalFieldColumns: true`
- `exportDownloadHistory: true`
- `excelPartLimitMb: 30`

## 2. Create a new GitHub Pages site

Create a new public repository named `PRS2` under the existing `PRSAV` account.

Upload these root files:

- `index.html`
- `app.js`
- `styles.css`
- `sw.js`
- `manifest.webmanifest`
- `icon.svg`

Enable GitHub Pages from `main` / root.

Expected website:

`https://prsav.github.io/PRS2/`

The frontend is already configured for the new Worker URL `https://pv-capture-ai-v2.mahipal-office21.workers.dev`.

## 3. Clean-data guarantee

The recommended setup uses a brand-new D1 and brand-new R2 bucket, so it contains zero V12 data. The Worker additionally uses only `v20_*` D1 tables and `v20/` R2 object prefixes. The existing V12 deployment is not contacted by this frontend.

## 4. First device tests

After deployment, test on both Android Chrome and iPhone Safari:

1. Create a fresh test company.
2. Take a photo and allow location permission.
3. Confirm image compression still gives a clear preview.
4. Confirm Latitude / Longitude populate when available but can be blank and still save.
5. Scan a QR containing JSON such as `{"City":"Ahmedabad","Asset Name":"Office Chair","Barcode":"CHAIR-001"}` and confirm matching fields auto-fill.
6. Scan a normal barcode and confirm the Barcode / QR / Asset Tag field is filled.
7. Add a custom field, save a record, then deactivate the field and save another record. Export and confirm the historical field column still exists.
8. Export with photos and without photos; confirm both appear under Download History.
9. For a large photo set, confirm XLSX parts do not exceed 30 MB and multi-part exports download as one ZIP.
