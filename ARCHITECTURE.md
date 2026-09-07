# PRS.AssetVerify 2.0 architecture

## Language decision

The best source language for this project is TypeScript because both the browser PWA and Cloudflare Workers run on the JavaScript platform, while TypeScript adds compile-time checks for API payloads, permissions, field schemas, export manifests, GPS states and scanner payloads.

For the first 2.0 replica, the deployable files remain plain JavaScript so the system can still be deployed directly through GitHub Pages and the Cloudflare dashboard without installing Node.js or a build tool. The 2.x codebase should migrate source modules to TypeScript progressively while continuing to ship compiled JavaScript deploy artifacts.

A rewrite to Python, Java or .NET would add a server/runtime that this architecture does not need. Rust/WASM may later be useful only for specialised image processing, but it is unnecessary for the current workload.

## Clean 2.0 environment

Use a separate GitHub site, Worker, D1 database and R2 bucket:

- GitHub repository: `PRS2`
- Website: `https://prsav.github.io/PRS2/`
- Worker: `pv-capture-ai-v2`
- Worker URL expected by this package: `https://pv-capture-ai-v2.mahipal-office21.workers.dev`
- D1 database: `pv-capture-db-v2`
- Worker D1 binding: `DB`
- R2 bucket: `pv-capture-photos-v2`
- Worker R2 binding: `Photos`
- OpenAI secret: `OPENAI_API_KEY`

The 2.0 Worker uses only `v20_*` tables and `v20/` R2 object prefixes. Even if the wrong D1 were accidentally bound, it would not query the old `v8_*` application tables. A separate D1 and R2 are still strongly recommended for operational isolation.

## Data-cost design

D1 stores metadata and compact JSON only. Photos and generated Excel files are stored in R2. Photos are compressed client-side before upload. Export history stores one D1 row per export job and per Excel part; the large XLSX bytes remain in R2.

This is intentionally cost-conscious. A later 2.x version can add export-retention rules, deduplication and lifecycle cleanup without redesigning the verification data model.

## Field schema history

Fields are never physically removed as part of normal Field Master deletion. A field is deactivated. Editing a field creates a new field revision and deactivates the old definition. Each company has a monotonically increasing schema version and each new verification stores the schema version under which it was captured.

Excel therefore contains:

- `All Records`: union of historical field revisions, so an old column never disappears.
- `Current Schema`: the currently active field/export-column view.
- `Field History`: field IDs, status and schema versions.
- `Export Info`: export metadata.

## Scanner design

The camera scanner supports QR and common 1D/2D formats through html5-qrcode. A plain barcode automatically fills `Barcode / QR / Asset Tag`. Structured QR values can auto-fill matching fields when encoded as JSON, URL query parameters, or `key:value` / `key=value` pairs. Matching is case/space/punctuation-insensitive against field label, field ID and system key.

A plain barcode cannot truthfully populate Asset Name, City or other attributes unless there is a code-to-asset master. A later version can add an Asset Master lookup without changing the scanner parser.

## GPS design

GPS begins on the direct user tap before the camera/gallery/scanner UI opens. This is important for iOS Safari permission behaviour. The PWA runs both a high-accuracy `watchPosition` and one-shot requests, then falls back to a network-assisted location request. The best available accuracy is used. GPS remains optional and never blocks saving.

## Image compression

Captured/gallery images are converted to JPEG in-browser, resized to a maximum dimension of 1600 px and iteratively compressed toward approximately 650 KB. This reduces upload bandwidth, R2 storage, Excel size and mobile memory pressure.

## Export size control

Every `.xlsx` part is measured after ExcelJS serialises the actual workbook. A part is accepted only when its actual byte size is <= 30 MB. Oversized record groups are recursively split and rebuilt until every part passes the limit. This is more reliable than guessing from the number of photos.

When an export needs multiple XLSX parts, the app downloads them together in a single ZIP on one click. Both `with photos` and `without photos` variants are generated for the same snapshot and stored in Download History.
