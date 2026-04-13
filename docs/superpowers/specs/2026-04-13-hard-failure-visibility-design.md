# Hard Failure Visibility and Correction

Date: 2026-04-13
Status: Revised

## Problem

The current visibility problem is not one bug. It is two primary gaps plus two secondary UX issues.

Primary gaps:

- View Errors depends on `measurement_error_log`, not just `measurementssummary`. The Errors Explorer reads `measurement_error_log -> coremeasurements -> measurementssummary`. If an unresolved row has no unresolved `measurement_error_log` link, it is invisible there even when the row exists in `coremeasurements` and `measurementssummary`.
- View Data uses `measurementssummary`, not `viewfulltable`. Its default filters require `UserDefinedFields.$.treestemstate` to be one of `old tree`, `multi stem`, or `new recruit`. A row corrected through the Errors Explorer can resolve onto a real stem and still remain hidden if `treestemstate` is not restored.

Secondary issues:

- `viewfulltable` can remain stale after an inline correction. That affects the historical-data screen, not the primary View Data symptom.
- Invalid attribute codes remain soft-validated and are dropped from `cmattributes`. The original value survives in `coremeasurements.RawCodes`, but the UI does not expose it, so users can see a blank Attributes column with no explanation.

Important correction to the earlier design assumption: in live Panama, unresolved rows are not consistently being dropped from `measurementssummary`. We verified rows already materialized there with sentinel foreign-key values (`0`). That makes a nullable-foreign-key redesign optional cleanup, not the root fix for the Cocoli report.

### Verified Scenarios

| Case | Verified live state | Root cause |
|------|---------------------|------------|
| `011375` stem `5` | Corrected row is ingested and resolved, but `UserDefinedFields` is `NULL` | Missing `treestemstate` after correction |
| `011377` | `hirtra` is a valid species; row is unresolved with invalid code `I` and no unresolved `measurement_error_log` row | Orphan unresolved row |
| `011381` stem `1` | Unresolved row with invalid code `MX` has no unresolved `measurement_error_log` row; a different clean stem for tree `011381` is what the user sees in View Data | Orphan unresolved row; separate RawCodes UX gap |
| `011383` | Duplicate tag/stem rows are unresolved and lack unresolved `measurement_error_log` rows | Orphan unresolved rows, likely missing seeded error definition or failed log insert |

## Design Goals

1. Every unresolved hard failure must appear in View Errors.
2. Every successfully corrected row must reappear in default View Data without requiring users to change filters.
3. Historical-data screens should refresh promptly after inline corrections.
4. Invalid dropped codes should be inspectable, but that is a secondary UX improvement.
5. Schema cleanup for unresolved rows should not block the first two fixes.

## Section 1: Error Log Integrity for Unresolved Rows

`measurement_error_log` remains the system of record for unresolved ingestion and validation visibility:

- View Errors reads from it.
- measurement visibility filters treat unresolved `measurement_error_log` rows as error rows.
- refresh queries derive the `Errors` display column from it.

Required changes:

1. **Guarantee unresolved log creation**
   - Audit `bulkingestionprocess` so every supported hard-failure row can join to a real `measurement_errors` definition and insert into `measurement_error_log`.
   - Add any missing seeded error definitions for still-supported hard-failure codes.
   - If an ingestion path produces an unresolved row but cannot create the error-log link, fail noisily in logs instead of silently leaving the row orphaned.

2. **Backfill existing orphan rows**
   - Add a one-off repair script or migration that finds unresolved `coremeasurements` rows missing an unresolved `measurement_error_log` row.
   - Map those rows to canonical `measurement_errors` definitions and insert the missing unresolved links.
   - Prefer mapping from structured ingest context or known error code outputs. Do not rely on brittle free-text `Description` parsing unless there is no better key.

3. **Do not reintroduce invalid attribute codes as a permanent hard failure**
   - Invalid attribute codes should stay soft-validated.
   - If the brief hard-fail regression already left orphan rows behind in a deployed schema, repair those rows one-off instead of institutionalizing `INVALID_ATTRIBUTE_CODE` as a required hard-failure seed.

4. **Do not bypass `measurement_error_log`**
   - The Errors Explorer query shape stays the same.
   - The fix is to restore the missing unresolved links, not to teach the UI to infer errors from `coremeasurements.Description`.

## Section 2: Restore / Recompute `treestemstate` After Correction

When a View Errors correction resolves a row onto a real tree/stem, the row must regain the same `UserDefinedFields.treestemstate` metadata that bulk ingestion would have assigned. Without that metadata, the default View Data filters hide the row even though it is fully resolved.

Required changes:

1. **Update the correction path**
   - After species/tree/stem resolution succeeds for a `measurementssummary` PATCH, compute the row's tree-stem state using the same classification rules as ingestion:
     - previous census stem match -> `old tree`
     - previous census tree match only -> `multi stem`
     - no previous match -> `new recruit`
   - Only write `treestemstate` once the row is truly resolved onto a real stem/tree identity.

2. **Preserve existing metadata**
   - Merge the recomputed `treestemstate` into `coremeasurements.UserDefinedFields`.
   - Preserve existing `uploadSession` and any other keys already present in `UserDefinedFields`.

3. **Prefer shared logic over duplicate logic**
   - Reuse the same classification logic as ingestion where possible.
   - The single-row reingest path already preserves `UserDefinedFields` from a successfully reprocessed row. The inline correction path should either share that logic or produce the same output, so the two correction paths do not drift.

4. **Refresh `measurementssummary` after metadata repair**
   - Once `UserDefinedFields` is repaired, refresh `measurementssummary` for the affected plot/census scope.
   - This is the change that fixes the `011375` stem `5` symptom in the default View Data screen.

## Section 3: Scoped `viewfulltable` Refresh for Historical Data

This is still worth doing, but it is secondary. It fixes historical-data staleness after inline corrections; it is not the primary fix for the missing row in View Data.

Changes:

1. Add `refreshViewFullTableForScope` in `frontend/app/api/refreshviews/[view]/[schema]/route.ts`.
2. Update the refresh API route so scoped `viewfulltable` refreshes do not require a full rebuild.
3. Call the scoped `viewfulltable` refresh alongside the existing scoped `measurementssummary` refresh after an Errors Explorer correction.
4. Verify the post-ingestion flow also refreshes `viewfulltable` where appropriate.

## Section 4: Invalid Attribute Code Visibility

This remains a useful UX improvement, but it is not the root fix for the Cocoli visibility bugs.

Changes:

1. Expose `RawCodes` somewhere user-visible for rows where materialized `Attributes` differs from the original code list.
2. Keep invalid attribute codes as soft validation only.
3. Make the UI explain when codes were dropped rather than showing a blank Attributes cell with no context.

Implementation options:

- add `RawCodes` to `measurementssummary` and `viewfulltable`, or
- expose it from `coremeasurements` in a detail panel / error drawer without widening both summary tables.

The exact UI can be decided later. The important point is preserving soft-validation behavior while making the drop visible.

## Section 5: Optional Cleanup for `measurementssummary`

If we want to represent unresolved rows more honestly, we can later replace the current sentinel-value behavior with nullable foreign keys and a simpler primary key.

That cleanup is optional and should be treated as a separate migration project, not as a prerequisite for the Cocoli fixes.

If pursued later:

1. Make `StemGUID`, `TreeID`, `SpeciesID`, and `QuadratID` nullable in `measurementssummary`.
2. Consider simplifying the primary key to `CoreMeasurementID`.
3. Audit any indexes or SQL logic that currently assume non-null foreign keys or rely on `0` sentinel behavior.
4. Confirm duplicate detection and summary consumers still behave correctly with `NULL` values.

## Implementation Order

1. Repair error-log integrity for unresolved rows.
2. Restore / recompute `treestemstate` in the inline correction path.
3. Add scoped `viewfulltable` refresh for historical data.
4. Expose `RawCodes` if we want clearer invalid-code UX.
5. Evaluate nullable-foreign-key cleanup separately.

## Files to Modify

### Required for the primary fixes

| File | Changes |
|------|---------|
| `frontend/sqlscripting/storedprocedures.sql` | Ensure supported hard failures consistently create unresolved `measurement_error_log` rows |
| `frontend/db-migrations/` or repair script location | Seed missing still-supported hard-failure codes and backfill orphan unresolved rows |
| `frontend/config/macros/coreapifunctions.ts` | Recompute and persist `UserDefinedFields.treestemstate` after successful inline correction |

### Secondary follow-on work

| File | Changes |
|------|---------|
| `frontend/app/api/refreshviews/[view]/[schema]/route.ts` | Add scoped `viewfulltable` refresh for historical data |
| `frontend/components/errors/errorsexplorer.tsx` | Call scoped `viewfulltable` refresh after correction |
| `frontend/sqlscripting/storedprocedures.sql` and/or refresh routes | Expose `RawCodes` if we decide to surface dropped invalid codes |

### Optional cleanup

| File | Changes |
|------|---------|
| `frontend/sqlscripting/tablestructures.sql` | Nullable foreign keys / key-shape cleanup for `measurementssummary` |
| `frontend/db-migrations/` | Separate migration for nullable-foreign-key cleanup |

## What Does NOT Change

- The Errors Explorer continues to read `measurement_error_log -> coremeasurements -> measurementssummary`.
- View Data continues to use `measurementssummary`, not `viewfulltable`.
- Default tree-stem-state filters remain in place; the fix is to restore the missing metadata, not to loosen the filters.
- Invalid attribute codes remain soft-validated.
- `viewfulltable` remains the historical-data path, not the primary View Data source.
- Nullable-foreign-key cleanup in `measurementssummary` is not required to fix the current user report.

## Risks

- **Backfill mapping can be brittle:** Prefer canonical error-code or ingest-path mapping over parsing `Description` text.
- **TSS logic can drift:** If the inline correction path reimplements tree-stem-state classification independently, it may diverge from ingestion. Shared logic is preferable.
- **Temporary invalid-code regression data may still exist in deployed schemas:** Repair those rows one-off, but do not let them drive permanent hard-failure design.
- **Nullable-foreign-key cleanup would still require an audit:** If we later replace sentinel `0` values with `NULL`, we must recheck indexes, duplicate detection, and any SQL consumers that currently depend on the existing shape.
