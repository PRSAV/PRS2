PRS.AssetVerify 2.0.4 - Mobile Decoder Replacement

Replace these GitHub PRS2 files only:
- index.html
- app.js
- sw.js

No Cloudflare Worker, D1, R2 or OpenAI changes are required.

Changes:
- Replaces html5-qrcode live decoder with @zxing/browser 0.2.1.
- Continuous multi-format mobile decoding for QR + common barcodes.
- High-resolution rear camera request.
- Best-effort autofocus and 1.5x zoom for small asset labels.
- Automatic code -> Barcode / QR / Asset Tag -> verification form.
- Uploaded scan images also use ZXing.
- Service-worker cache bumped to force new scanner assets.
