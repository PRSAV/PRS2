PRS.AssetVerify 2.0.3 Mobile Scanner Fix

Replace only app.js and sw.js in the PRS2 GitHub repository.
No Cloudflare/D1/R2 change is required.

Changes:
- iPhone/Android camera is requested directly from Start Camera.
- Removed pre-camera GPS request.
- Removed pre-start camera enumeration.
- Uses full-frame ZXing decoder path through html5-qrcode.
- Automatically stops after first scan and fills Barcode / QR / Asset Tag.
- GPS starts after scan and remains optional.
