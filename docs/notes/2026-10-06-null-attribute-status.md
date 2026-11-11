# Decision note: attribute Status = NULL (#425)

Mason decided that `attributes.Status = NULL` means **unspecified**, including
for neutral or mixed-use codes whose Description may read like a biological
state. NULL is not inferred from `Code` or `Description`, and it grants no
automatic growth/shrinkage exemption and is not treated as alive, dead, or
broken. Explicit status mapping continues exactly as the existing validation
rules define it; the exemption logic was not changed. Clearing a status
persists SQL NULL; choosing an explicit status persists that value. The UI
warns that a NULL status carries no status-based exemption; no biological
status is assigned automatically.

Site-level cleanup of existing NULL-status codes is a reviewed data decision
for each site's own owners, not a bulk automatic mapping or sweep performed by
this change.

An authorized read-only audit (2026-10-07T02:01:35.166Z) inspected the 13
catalogued schemas over a verified-TLS, read-only transaction with bounded
SELECTs, then rolled back and closed the connection, with zero errors. It
found 58 active NULL-status attribute codes across 11 non-test sites (the
`forestgeo_testing` and `forestgeo_testing_mason` schemas were excluded).

This warning and the nullable-status editing UI do not complete any site's
cleanup and do not classify any specific site's codes. #305's missing-by-design
cases remain unagreed; no new exemptions were introduced. This covers #425 and
#369 item 1 only -- #369 as a whole stays open.
