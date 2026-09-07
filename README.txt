PRS.AssetVerify 2.0.6 mobile scanner patch

Changes:
- Android uses native BarcodeDetector first; no longer requires ZBar WASM to load when native scanning is available.
- iPhone continues using the working ZBar WASM fallback.
- Every successful LIVE camera scan automatically captures the exact scanner camera frame as evidence before the camera closes.
- The scan evidence photo is compressed by the existing image compressor, uploaded with the record, displayed in records, and embedded in the With Photos Excel export.
- GPS/export/database logic otherwise unchanged.

Replace in GitHub PRS2:
- app.js
- sw.js

index.html is included only with an updated explanatory comment; replacing it is optional.
Cloudflare/D1/R2/OpenAI do not need changes.
