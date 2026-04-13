# Hard Failure Visibility and Correction

Date: 2026-04-13
Status: Approved

## Problem

Hard-failed records (invalid species, duplicate tags, etc.) are inserted into `coremeasurements` with `StemGUID = NULL` but are invisible in every user-facing view:

- `measurementssummary` has NOT NULL constraints on StemGUID, TreeID, SpeciesID, QuadratID (all part of the composite primary key). `INSERT IGNORE` silently drops hard-failed rows.
- `viewfulltable` uses `INNER JOIN stems` and `WHERE cm.StemGUID IS NOT NULL`, explicitly filtering them out.
- View Errors also depends on `measurement_error_log`, not just `measurementssummary`. The Errors Explorer reads `measurement_error_log -> coremeasurements -> measurementssummary`; rows with no unresolved error-log link are invisible there even if they exist in `measurementssummary`.
- View Data queries `viewfulltable`, so hard failures never appear.

Additionally, invalid attribute codes (like "MX", "I") are silently dropped from `cmattributes` after commit `1c8fbbbb`. The original codes are preserved in `coremeasurements.RawCodes` but never exposed to the UI. Users see an empty Attributes column with no explanation.

Finally, after correcting a record in View Errors, only `measurementssummary` is refreshed. `viewfulltable` stays stale until a manual "Reset View" click, which does a full TRUNCATE + rebuild. Separately, the correction path can resolve a row onto a real stem without restoring `UserDefinedFields.treestemstate`, so the row still fails the default View Data tree-stem-state filter and remains hidden.

### Affected Scenarios (from user report)

| Tree | Issue | Root Cause | Current Behavior |
|------|-------|-----------|-----------------|
| 011375 stem 5 | Typo `ixorfi` (invalid species) | INVALID_SPECIES hard failure | Invisible everywhere |
| 011377 | Code "I" + possibly invalid species `hirtra` | Hard failure | Invisible everywhere |
| 011381 | Code "MX" (invalid attribute) | Soft validation, codes silently dropped | Appears in View Data with empty Attributes |
| 011383 | Duplicate stemtag (two rows with tag=1) | DUPLICATE_TAG_STEMTAG hard failure | Invisible everywhere |

## Design

All ingested records (valid and invalid) should appear in View Data. Records with unresolved errors also appear in View Errors. Users filter by `IsValidated` to distinguish:
- `FALSE` = hard failure (StemGUID IS NULL, ingestion rejected)
- `NULL` = ingested, not yet validated
- `TRUE` = validated, no errors

### Section 1: Schema Migration (measurementssummary)

Make StemGUID, TreeID, SpeciesID, QuadratID nullable. Change primary key from `(CoreMeasurementID, StemGUID, TreeID, SpeciesID, QuadratID, PlotID, CensusID)` to `(CoreMeasurementID)`.

PlotID, CensusID remain NOT NULL (hard failures always have a valid census).

`viewfulltable` already defines these columns as nullable. No FK-nullable schema change needed there (RawCodes column addition is in Section 5).

`measurementssummary.MeasurementDate` is currently `NOT NULL`. Hard failures use `NULLIF(tm.MeasurementDate, '1900-01-01')` which can produce NULL. Make MeasurementDate nullable, or use `COALESCE(cm.MeasurementDate, '1900-01-01')` in refresh queries to ensure a value. Prefer making it nullable for data honesty — a missing date should show as missing, not as a sentinel.

Migration script:

```sql
ALTER TABLE measurementssummary DROP PRIMARY KEY;
ALTER TABLE measurementssummary
  MODIFY StemGUID INT NULL,
  MODIFY TreeID INT NULL,
  MODIFY SpeciesID INT NULL,
  MODIFY QuadratID INT NULL,
  MODIFY MeasurementDate DATE NULL;
ALTER TABLE measurementssummary ADD PRIMARY KEY (CoreMeasurementID);
```

### Section 2: Refresh Query Updates

Three queries need the same pattern change:

1. `RefreshMeasurementsSummary` stored proc (storedprocedures.sql)
2. `refreshMeasurementsSummaryForScope` TS function (refreshviews route.ts)
3. `RefreshViewFullTable` stored proc (storedprocedures.sql)

Changes:
- Convert INNER JOINs on `stems` and `trees` to LEFT JOINs
- Remove `WHERE cm.StemGUID IS NOT NULL` from RefreshViewFullTable
- Use Raw* column fallbacks for display columns:

```sql
COALESCE(t.TreeTag, cm.RawTreeTag)       AS TreeTag,
COALESCE(s.StemTag, cm.RawStemTag)       AS StemTag,
COALESCE(sp.SpeciesCode, cm.RawSpCode)   AS SpeciesCode,
COALESCE(q.QuadratName, cm.RawQuadrat)   AS QuadratName,
COALESCE(s.LocalX, cm.RawX)             AS StemLocalX,
COALESCE(s.LocalY, cm.RawY)             AS StemLocalY,
```

`RefreshMeasurementsSummary` already uses LEFT JOINs and some COALESCE fallbacks. The remaining fallbacks (StemTag, coordinates) need adding. `RefreshViewFullTable` needs both the JOIN change and the fallback additions.

### Section 3: Error Explorer Query Updates

The error explorer queries in `_shared.ts` are already null-tolerant:

- `buildRawErrorsQuery`: JOINs measurement_error_log to measurementssummary. Hard failures will now be in measurementssummary, so this works without changes.
- `buildDuplicateGroupsQuery`: Groups by TreeTag + StemTag. Raw* fallbacks mean these are populated for hard failures. No change needed.
- `buildSameBatchConflictGroupsQuery`: Uses `COALESCE(ms.SpeciesCode, '')`. No change needed.
- Quick search filters on string columns that will be populated via Raw* fallbacks.

No code changes required in this section.

### Section 4: Error Log Integrity for Unresolved Rows

`measurement_error_log` remains the system of record for unresolved ingestion/validation visibility:

- View Errors reads from `measurement_error_log`
- measurement visibility filters treat unresolved error-log rows as invalid/error rows
- refresh queries derive the `Errors` display column from `measurement_error_log`

Therefore, unresolved rows must always have the appropriate `measurement_error_log` links.

Changes:

1. **Guarantee error-log creation for hard failures**
   - Audit `bulkingestionprocess` paths so every `hard_failure_rows.ErrorCode` can join to a real `measurement_errors` row and insert into `measurement_error_log`.
   - Add any missing seeded error definitions required by the still-supported hard-failure codes.

2. **Backfill orphaned unresolved rows**
   - Add a one-off repair script/migration that finds `coremeasurements` rows with `StemGUID IS NULL` whose `Description` / known ingest context indicates a hard failure but which have no unresolved `measurement_error_log` row.
   - Insert the missing `measurement_error_log` links by mapping to the canonical `measurement_errors` definitions.

3. **Do not change Errors Explorer query shape**
   - `_shared.ts` continues to read `measurement_error_log -> coremeasurements -> measurementssummary`.
   - The fix is to restore the missing log links, not to bypass `measurement_error_log`.

### Section 5: Restore / Recompute `treestemstate` After Correction

When a View Errors correction resolves a row onto a real tree/stem, the row must regain the same `UserDefinedFields.treestemstate` metadata that bulk ingestion would have assigned. Without that metadata, the default View Data filters hide the row even though it is fully resolved.

Changes:

1. **Update the correction path in `coreapifunctions.ts`**
   - After species/tree/stem resolution succeeds for a `measurementssummary` PATCH, compute the row's tree-stem state using the same classification rules as ingestion:
     - previous census stem match -> `old tree`
     - previous census tree match only -> `multi stem`
     - no previous match -> `new recruit`

2. **Preserve existing metadata**
   - Merge the recomputed `treestemstate` into `coremeasurements.UserDefinedFields`.
   - Preserve existing `uploadSession` or other keys already present in `UserDefinedFields`.

3. **Refresh summary views after metadata repair**
   - After writing the corrected `UserDefinedFields`, refresh `measurementssummary`.
   - `viewfulltable` refresh remains a separate concern for the historical-data screen.

### Section 6: Scoped viewfulltable Refresh + PATCH Wiring

**New function:** `refreshViewFullTableForScope` in `frontend/app/api/refreshviews/[view]/[schema]/route.ts`. Follows the same DELETE + INSERT pattern as `refreshMeasurementsSummaryForScope`:
- `DELETE FROM viewfulltable WHERE PlotID = ? AND CensusID = ?`
- Re-insert using the updated SELECT (LEFT JOINs, Raw* fallbacks) scoped to that plot+census.

**Update refresh API route** (line 246-252): When `view === 'viewfulltable'` and plotID+censusID are provided, call the scoped version instead of `CALL RefreshViewFullTable()`.

**Wire into errors explorer PATCH flow** (errorsexplorer.tsx:441): After the existing measurementssummary refresh, add a parallel viewfulltable refresh:

```typescript
await Promise.all([
  refreshMeasurementsSummaryScope(rowScope),
  refreshViewFullTableScope(rowScope)
]);
```

**Verify ingestion completion flow:** After `bulkingestionprocess` finishes, both RefreshMeasurementsSummary and RefreshViewFullTable should be called. Check `frontend/components/processors/processbulkingestion.tsx` for the post-ingestion refresh calls. If RefreshViewFullTable is missing, add it alongside the existing RefreshMeasurementsSummary call.

### Section 7: Invalid Attribute Code Visibility

**Add `RawCodes` column** to both `viewfulltable` and `measurementssummary` refresh queries. Include `cm.RawCodes` in the SELECT statements.

Schema additions:
- `viewfulltable`: add `RawCodes varchar(255) null`
- `measurementssummary`: add `RawCodes varchar(255) null`

**Frontend:** When `RawCodes` differs from `Attributes`, the UI indicates that some codes were dropped. Exact treatment (tooltip, icon, secondary text) decided during implementation. The key is that the data is available for display.

No change to ingestion behavior. Invalid codes still get dropped from `cmattributes`. We are only making the drop visible.

## Files to Modify

| File | Changes |
|------|---------|
| `frontend/sqlscripting/tablestructures.sql` | measurementssummary PK + nullable columns, RawCodes column on both tables |
| `frontend/db-migrations/` | New migration script for schema changes |
| `frontend/sqlscripting/storedprocedures.sql` | RefreshMeasurementsSummary + RefreshViewFullTable: LEFT JOINs, Raw* fallbacks, remove WHERE filter, add RawCodes |
| `frontend/app/api/refreshviews/[view]/[schema]/route.ts` | Update refreshMeasurementsSummaryForScope, add refreshViewFullTableForScope, update route handler |
| `frontend/components/errors/errorsexplorer.tsx` | Add viewfulltable refresh to PATCH flow |
| `frontend/config/macros/coreapifunctions.ts` | Recompute and persist `UserDefinedFields.treestemstate` after successful correction |
| `frontend/config/measurementerrors.ts` or repair script | Ensure / backfill `measurement_error_log` links for unresolved hard failures |

## What Does NOT Change

- `bulkingestionprocess` stored procedure (ingestion logic unchanged)
- Hard failure detection and classification (same error codes)
- Error explorer component queries (already null-tolerant; visibility is fixed by restoring missing `measurement_error_log` links)
- TypeScript type definitions (already mark these fields as optional)
- Frontend grid column definitions (already handle null/undefined)
- `cmattributes` materialization (invalid codes still dropped, correct behavior)

## Risks

- **Code assuming measurementssummary rows have resolved FKs:** Audit found no TypeScript code making this assumption (types already optional). SQL-side, the collapser and post-validation queries operate on `coremeasurements` directly, not measurementssummary.
- **Index changes on measurementssummary:** The `idx_mss_dup_detect` composite index includes StemGUID. With NULLs, its behavior changes (NULLs are not equal in MySQL index comparisons). Verify dedup detection still works.
- **Performance of scoped viewfulltable refresh:** DELETE + INSERT for a single plot+census should be fast. The full TRUNCATE+rebuild (manual "Reset View") remains available as fallback.
