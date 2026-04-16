# Measurement Revision Upload

**Date:** 2026-04-14
**Status:** Draft

## Problem

Researchers currently have no way to upload corrections to existing census measurement data. The only upload path is the full ingestion pipeline (`temporarymeasurements` -> `bulkingestionprocess` -> `coremeasurements`), which is designed for initial data entry. If a researcher exports their census data, corrects a few rows, and wants to push those corrections back, they must either edit rows one-by-one in the UI or re-upload the entire dataset.

## Solution

Add a `REVISIONS` upload mode for measurements, following the same pattern already used by species, attributes, quadrats, and personnel uploads. Researchers export their data, edit specific rows in the CSV, and re-upload. The system matches rows to existing measurements and applies targeted updates.

## Design Decisions

### Supported Input Formats

Measurement revision upload must accept both of these app-generated CSV surfaces after user edits:

1. **Canonical form-download exports** using short-form headers like `stemID`, `tag`, `stemtag`, `spcode`, `quadrat`, `lx`, `ly`, `dbh`, `hom`, `date`, `codes`, `comments`.
2. **View Data / datagrid exports** using display headers like `StemGUID`, `TreeTag`, `StemTag`, `SpeciesCode`, `QuadratName`, `StemLocalX`, `StemLocalY`, `MeasuredDBH`, `MeasuredHOM`, `MeasurementDate`, `Description`, `Attributes`, and `RawCodes`.

Both formats are normalized to the same canonical short-form keys before matching and diffing.

| Accepted Header | Canonical Key |
|---|---|
| `StemGUID`, `stemID`, `stemid` | `stemid` |
| `TreeTag`, `tag` | `tag` |
| `StemTag`, `stemtag` | `stemtag` |
| `SpeciesCode`, `spcode` | `spcode` |
| `QuadratName`, `quadrat` | `quadrat` |
| `StemLocalX`, `LocalX`, `lx` | `lx` |
| `StemLocalY`, `LocalY`, `ly` | `ly` |
| `MeasuredDBH`, `dbh` | `dbh` |
| `MeasuredHOM`, `hom` | `hom` |
| `MeasurementDate`, `date` | `date` |
| `Description`, `Comments`, `comments` | `comments` |
| `codes` | `codes` |
| `RawCodes` | `rawcodes` → canonicalized to `codes` |
| `Attributes` | `attributes` → canonicalized to `codes` if no higher-priority code column exists |

When multiple code-bearing columns are present in one row, precedence is:

1. `codes`
2. `RawCodes`
3. `Attributes`

This avoids header-collision ambiguity in datagrid exports that contain both `Attributes` and `RawCodes`.

Literal `NULL` strings from app exports are treated as blank cells during revision parsing.

### Row Matching

The system uses a two-tier matching strategy, scoped to the active census:

1. **Primary key: `stemID` (StemGUID)** -- If the uploaded CSV contains a `stemID` column with values, match against `coremeasurements.StemGUID`. This is the most precise match (one-to-one) and is always present in exported CSVs.

2. **Fallback key: `tag` + `stemtag`** -- If `stemID` is absent or empty, match on `trees.TreeTag` + `stems.StemTag` within the active census. This composite key is guaranteed unique within a census by the existing dedup logic in `bulkingestionprocess`.

The strategy is chosen per-file, not per-row: if the CSV has a `stemID` column header and at least one row has a non-empty `stemID` value, the entire file uses `stemID` matching. Otherwise the entire file uses `tag` + `stemtag` matching. Mixing strategies within a single file is not supported.

Both match strategies query against the same joined tables (`coremeasurements` + `stems` + `trees`), differing only in the WHERE clause.

### Update Semantics

**Non-destructive merge:** Only columns with non-empty values in the revision CSV overwrite existing data. Blank/empty cells are treated as "don't change." This lets researchers submit a file with just the columns they want to fix without risking blanking out untouched data.

This differs from the species REVISIONS mode, which uses full-overwrite semantics. The difference is intentional -- measurement revisions are corrections to specific fields, not full-row replacements.

### Extra Columns

Any column the system does not recognize (e.g., `errors`, `treeID`, `notes_for_team`, or any researcher-added bookkeeping columns) is silently ignored during import. The parser reads them but the revision logic only processes known columns.

### New Row Handling

When revision rows don't match any existing measurement in the census:

1. The system separates them into a "new rows" set.
2. The user is shown the unmatched rows in a review table so they can inspect them.
3. The user must explicitly confirm before new rows are created.
4. Confirmed new rows go through the existing `temporarymeasurements` -> `bulkingestionprocess` pipeline (they are genuinely new data).

If showing rows in a table proves too complex during implementation, fall back to a summary count ("N rows don't match existing measurements and will be created as new entries") with confirm/cancel.

### Validation

Updated rows go through the full validation suite, same as a fresh upload. Revised measurements get re-validated and any new errors appear in `cmverrors` / `measurement_error_log`. This keeps data integrity consistent regardless of how data entered the system.

### Data Flow

Revision mode bypasses `temporarymeasurements` and `bulkingestionprocess` for matched rows. The flow is:

```
CSV file
  |
  v
Parse & validate headers (reuse uploadparsefiles)
  |
  v
Match rows against existing coremeasurements (new API route)
  |
  +-- Matched rows --> Direct UPDATE on coremeasurements
  |                    --> Run validations on updated rows
  |
  +-- Unmatched rows --> Show review table to user
                         --> If confirmed: route through temporarymeasurements
                             -> bulkingestionprocess (existing pipeline)
                         --> If rejected: skip these rows
```

## Architecture

### Column Requirements in Revision Mode

In revision mode, column requirements are relaxed compared to a fresh upload:

- **Required:** At least one match key -- either `stemID`/`StemGUID`, or both `tag`/`TreeTag` and `stemtag`/`StemTag`
- **Optional:** All other columns (`spcode`, `quadrat`, `lx`, `ly`, `dbh`, `hom`, `date`, `codes`, `comments`). Only columns present with non-empty values trigger updates.

### Updatable Fields

When a matched row is updated, the following fields can be revised:

| CSV Column | DB Target | Table |
|-----------|-----------|-------|
| `dbh` | `MeasuredDBH` | `coremeasurements` |
| `hom` | `MeasuredHOM` | `coremeasurements` |
| `date` | `MeasurementDate` | `coremeasurements` |
| `codes` | `cmattributes` join table | `cmattributes` (delete + re-insert) |
| `comments` | `Description` | `coremeasurements` |

Phase 1 is intentionally limited to row-local measurement fields. `spcode`, `quadrat`, `lx`, `ly`, `tag`, and `stemtag` may still appear in revision files because they are needed for matching and new-row creation, but they are not updated on matched measurements in this phase.

### API Route

A new API route handles revision processing:

**`POST /api/revisionupload`**

Request body:
- `rows`: parsed CSV rows (array of `FileRow`)
- `plotID`: active plot
- `censusID`: active census
- `schema`: site schema name

Response (phase 1 -- matching):
- `matchedRows`: array of `{ csvRow, coreMeasurementID, duplicateMeasurementIDsToDelete?, existingValues, changes }`
- `newRows`: array of unmatched CSV rows that can be inserted through the existing ingestion pipeline
- `invalidRows`: array of `{ csvRow, csvIndex, reason }` rows that could not be matched or staged safely
- Matching strategy is chosen per file (`stemID`/`StemGUID` first, then `tag` + `stemtag`)

After the user reviews unmatched rows and confirms:

**`POST /api/revisionupload/apply`**

Request body:
- `matchedRows`: the matched rows to update
- `newRows`: unmatched rows the user approved for creation
- `duplicateMeasurementIDsToDelete`: duplicate measurements to delete after a survivor row is chosen
- `schema`, `plotID`, `censusID`

Response:
- `updatedCount`: number of rows updated
- `insertedCount`: number of new rows created (via bulkingestionprocess)
- `skippedCount`: rows skipped (no changes detected)
- `deletedDuplicateCount`: duplicate rows removed from the census
- `applyErrors`: any row-level apply errors

### UI Flow

The upload flow in `uploadparent.tsx` already uses `ReviewStates` to manage the multi-step wizard, but revision mode is not just "two extra screens." It has to integrate with the modern measurement upload pipeline:

1. **`START` / measurement modal** -- Measurement revision mode must be explicitly selectable from the existing measurement upload entry point.

2. **`UPLOAD_FILES`** -- Revision files must be parsed and staged into an in-memory row set before matching. This step cannot assume that the standard measurement chunk-upload path has already produced reusable parsed rows.

3. **`REVISION_MATCH`** -- Sends the staged parsed rows to `/api/revisionupload` for classification. Shows a summary of matched rows, unchanged rows, new-row candidates, and invalid rows.

4. **`REVISION_APPLY`** -- Calls `/api/revisionupload/apply` to update matched rows directly and optionally route confirmed new rows through the standard ingestion pipeline. This step must participate in the same plot+census conflict protections used by uploads and validation runs.

5. **Post-apply validation / refresh** -- Successful apply does not end at a local success screen. Updated rows must enter the existing whole-census background validation flow, and the derived scoped views (`measurementssummary`, `viewfulltable`) must refresh for the affected plot+census after validation completes.

For measurements with `REVISIONS` mode selected, the user-visible flow becomes:

```
START -> UPLOAD_FILES (parse + stage) -> REVISION_MATCH -> REVISION_APPLY -> background validation -> COMPLETE
```

The implementation still reuses the surrounding upload shell, but it must account for parse staging, upload-session ownership/idempotency, conflict locking, and derived-view refreshes rather than only adding two review states and two routes.

### Component Changes

| Component | Change |
|-----------|--------|
| `uploadparent.tsx` | Add revision-mode routing plus explicit parse staging of revision files into an in-memory row set before `REVISION_MATCH` |
| `uploadstart.tsx` / measurement modal entry | Ensure measurement revision mode is exposed from the existing upload entry flow |
| `uploadsystemmacros.ts` | Add `REVISION_MATCH` and `REVISION_APPLY` to `ReviewStates` enum |
| `formdetails.ts` / form export | Ensure the canonical revision template/export includes `stemID` plus the Phase 1 revision columns |
| `measurementscommons.tsx` datagrid export | Treat edited View Data exports as a first-class supported revision input surface |
| New: `uploadrevisionmatch.tsx` | Matching results display, unmatched rows table, confirm/skip UI |
| New: `uploadrevisionapply.tsx` | Apply updates, show progress, handle conflicts/errors, then hand off to background validation |
| New: `/api/revisionupload/route.ts` | Row matching/classification logic over the staged parsed data |
| New: `/api/revisionupload/apply/route.ts` | Direct UPDATE execution for matched rows, routing of confirmed new rows through the standard ingestion path, and conflict checks against active uploads/validations |
| Existing upload-session / validation infrastructure | Reuse existing session ownership, idempotency, locking, and scoped refresh behavior rather than building a separate apply path outside those protections |

## Testing

### Integration Tests

- Upload a revision CSV with `stemID` -- verify matched rows are updated, unmatched rows flagged
- Upload an edited View Data export with headers like `StemGUID`, `MeasuredDBH`, and `QuadratName` -- verify it is normalized and matched correctly
- Upload a revision CSV without `stemID` -- verify fallback to `tag` + `stemtag` matching
- Upload with only some columns populated -- verify non-empty merge (blank cells don't overwrite)
- Upload a View Data export containing both `Attributes` and `RawCodes` -- verify `RawCodes` wins when both are present
- Upload with extra/unknown columns -- verify they are silently ignored
- Upload with all rows matching -- verify no new-row confirmation prompt
- Upload with some unmatched rows -- verify review table appears, confirm creates new rows
- Upload with some unmatched rows -- verify rejecting skips them
- Verify validations run on updated rows and errors appear in `measurement_error_log`
- Verify `codes` column updates correctly rebuild `cmattributes` associations
- Verify duplicate census measurements for the same stem resolve to one survivor plus deletion of extras

### Edge Cases

- CSV where every row is unmatched (effectively a new upload through revision mode)
- CSV where every row matches but no values changed (all skipped)
- Duplicate match keys in the CSV (last row wins silently per file)
- `stemID` column present but all values empty (should fall back to `tag` + `stemtag`)
- Row exported from View Data contains literal `NULL` placeholders -- parser should treat them as blank values
