PRS.AssetVerify 2.0.1 Scanner Fix

Replace ONLY these GitHub PRS2 frontend files:
- app.js
- sw.js

No Cloudflare Worker, D1 or R2 change is required.

Changes:
- robust camera permission warm-up
- detects available cameras after permission
- prefers rear/environment camera
- falls back to any available camera
- additional Safari/iPhone compatible camera constraints
- safe start/stop and cleanup
- clearer permission/busy/no-camera errors
- keeps Scan Image and manual entry fallback
- bumps service-worker cache so the new app.js is loaded
