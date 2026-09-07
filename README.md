# PRS.AssetVerify 2.0

PRS.AssetVerify 2.0 is a clean replica line based on the working V12 product, but it is intentionally isolated from V12 and starts with zero companies and zero records when deployed against the recommended new D1/R2 resources.

## New in 2.0

- Field schema history: deleting a field deactivates it; historical Excel columns never disappear.
- Editing a field creates a new schema-safe revision instead of silently mutating the old field definition.
- Each verification stores a schema version.
- `All Records`, `Current Schema`, `Field History` and `Export Info` Excel sheets.
- Scanner auto-fill for plain barcode/asset tag plus structured QR payloads.
- iPhone-friendly GPS warm-up started from the direct Take Photo / Gallery / Scanner tap.
- GPS remains optional.
- Improved image compression before cloud upload.
- Download History in the hamburger menu.
- Both Export with Photos and Export without Photos are generated and retained for re-download.
- Every generated XLSX part is capped at 30 MiB based on the actual final workbook bytes.
- Multi-part exports download together with one click as a ZIP.
- Standard Excel/System Columns master; Photo is locked and cannot be deactivated.
- Existing Admin/Verifier/Viewer, compulsory Admin, PIN, roles, audit, search, multi-image, offline queue, AI, backup/restore and company isolation features are retained.

See `ARCHITECTURE.md` for the engineering rationale and `V2_SETUP.md` for deployment.
