PRS.AssetVerify 2.0.2 – QR/Barcode live-camera auto-fill patch

Replace ONLY these GitHub PRS2 frontend files:
- app.js
- sw.js

No Cloudflare Worker, D1, R2, or OpenAI changes are required.

Behavior:
1. Scan & Verify -> Start Camera
2. Camera opens directly from the user tap (no temporary warm/open/close stream)
3. First QR/barcode decoded is accepted automatically
4. Scanner stops and verification form opens automatically
5. Plain QR/barcode payload is populated into Barcode / QR / Asset Tag
6. Structured QR key/value data still maps into matching fields

Sample QR supplied by user decodes to:
GDFPL/MAN/VKL/CBN/F&F/WC/027
