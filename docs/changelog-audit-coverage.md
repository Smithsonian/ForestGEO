# Changelog audit coverage — what `unifiedchangelog` does and does not record

## Current state

Rows in `unifiedchangelog` are written by application code, inside the same
transaction as the change they describe. There are three sources:

| Source | What it records |
|---|---|
| `config/macros/coreapifunctions.ts` (PATCH / POST / DELETE) | Grid-driven metadata mutations — plots, census, quadrats, species, personnel, attributes, and the tables an `alltaxonomiesview` or measurement write actually touches |
| `app/api/sqlpacketload/route.ts` | One `file_upload` row per uploaded file, plus quadrat-overlap acknowledgments |
| Stored procedures in `db/sql/storedprocedures.sql` | Ingestion-time inserts and error bookkeeping |

The writer is `lib/changelog/record-mutation.ts`. It takes the mutation's own
`TxExecutor`, so a rolled-back edit leaves no log row and a log row always
corresponds to a committed change.

**Not covered:** changes made by raw SQL outside the application. Only a database
trigger or binlog inspection can catch those. Do not describe the current state
as complete audit coverage.

## Why there are no triggers

There are no triggers on any ForestGEO schema, and there have not been since
2025-05-12. `information_schema.triggers` returns no rows for any schema; this is
not a privilege artifact, since the connecting user holds `TRIGGER` on `*.*`
`WITH GRANT OPTION`.

The history, for anyone who finds a reference to `db/sql/triggers.sql` in an old
document or branch:

- The file entered the repo in 2024-07 as `mysqldump` output — `DEFINER=azureroot@%`,
  `/*!50003*/` version guards, `DELIMITER ;;`. It was a **dump, never a
  deployment artifact**. The triggers it described were installed on the server
  by hand and dumped back for reference. No pipeline ever applied it:
  provisioning runs exactly three files (`lib/provisioning/steps/sql-steps.ts`) —
  `tablestructures.sql`, `storedprocedures.sql`, `corequeries.sql`. Every site
  provisioned since has been trigger-free from birth.
- **`9c1d7c76`** (2025-05-12, "versioning system completed") commented the audit
  triggers out and replaced them with census-versioning triggers targeting
  `speciesversioning` / `treeversioning`. That versioning system was later
  abandoned — neither table appears in `tablestructures.sql` — and its triggers
  were commented out too, leaving the file with 2,317 commented lines and eleven
  executable `drop trigger if exists` statements referencing triggers that do not
  exist.
- **`dd2ab343`** (2026-05-11) documented the gap in
  `docs/disaster-recovery-runbook.md`: *"Audit triggers in
  `frontend/sqlscripting/triggers.sql` are currently commented out, so raw-SQL
  deletes are not logged."* That commit lives only on the `backups` branch and
  was never merged, so the warning was invisible from `main`.
- **`bcb2b13d`** (2026-07-06) moved `sqlscripting/` → `db/sql/` without noticing
  the file was dead.

The residue was a `SET @CURRENT_CENSUS_ID` in the PATCH handler, carefully kept
on the transaction's connection "so the changelog trigger reads the session
variable this statement sets". Its only reader was a commented-out line in
`triggers.sql`. It had been decorative for roughly fifteen months.

`db/sql/triggers.sql` was deleted on 2026-08-06. The file remains recoverable
from git history; this note exists because the reasoning does not.

## How the gap was found

On 2026-08-05 the Harvard Forest plot record was corrected —
`plots.DefaultDBHUnits` from `mm` to `cm`, because Harvard collects in
centimetres. The edit succeeded and was recorded nowhere.

`unifiedchangelog` looked healthy, which is what disguised the gap: it held
`file_upload`, `coremeasurements` and `measurement_errors` rows across most
schemas. But **no schema held a single `plots`, `census` or `quadrats` row**. The
Changelog Explorer showed upload history and never revealed that someone had
retuned a validation threshold — and `plots.DefaultDBHUnits` is not cosmetic, it
is the multiplier in the growth and absurd-DBH checks in
`db/sql/storedprocedures.sql`.

## Verifying the premises

All read-only:

```sql
SHOW GRANTS;  -- expect TRIGGER on *.*
SELECT TRIGGER_SCHEMA, COUNT(*) FROM information_schema.triggers GROUP BY TRIGGER_SCHEMA;
SELECT TableName, COUNT(*) FROM forestgeo_harvard.unifiedchangelog GROUP BY TableName;
```
