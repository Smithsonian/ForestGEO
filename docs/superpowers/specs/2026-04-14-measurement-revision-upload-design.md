# Measurement Revision Upload

**Date:** 2026-04-14
**Status:** Draft

## Problem

Researchers currently have no way to upload corrections to existing census measurement data. The only upload path is the full ingestion pipeline (`temporarymeasurements` -> `bulkingestionprocess` -> `coremeasurements`), which is designed for initial data entry. If a researcher exports their census data, corrects a few rows, and wants to push those corrections back, they must either edit rows one-by-one in the UI or re-upload the entire dataset.

## Solution

Add a `REVISIONS` upload mode for measurements, following the same pattern already used by species, attributes, quadrats, and personnel uploads. Researchers export their data, edit specific rows in the CSV, and re-upload. The system matches rows to existing measurements and applies targeted updates.

## Design Decisions

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
  |                    (+ stems/trees if tag/stemtag/spcode/quadrat/lx/ly changed)
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

- **Required:** At least one match key -- either `stemID`, or both `tag` and `stemtag`
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
| `spcode` | `SpeciesID` (via species lookup) | `trees` |
| `quadrat` | `QuadratID` (via quadrat lookup) | `stems` |
| `lx` | `LocalX` | `stems` |
| `ly` | `LocalY` | `stems` |
| `tag` | `TreeTag` | `trees` |
| `stemtag` | `StemTag` | `stems` |

Note: `tag` and `stemtag` are updatable only when matching via `stemID`. When matching via `tag` + `stemtag`, those columns are consumed by the match and cannot also be updated.

### API Route

A new API route handles revision processing:

**`POST /api/revisionupload`**

Request body:
- `rows`: parsed CSV rows (array of `FileRow`)
- `plotID`: active plot
- `censusID`: active census
- `schema`: site schema name

Response (phase 1 -- matching):
- `matchedRows`: array of `{ csvRow, existingMeasurement, changes }` -- rows that matched with their diffs
- `unmatchedRows`: array of CSV rows that didn't match any existing measurement
- `matchStrategy`: `"stemID"` or `"tag_stemtag"` -- which key was used

After the user reviews unmatched rows and confirms:

**`POST /api/revisionupload/apply`**

Request body:
- `matchedRows`: the matched rows to update
- `confirmedNewRows`: unmatched rows the user approved for creation
- `schema`, `plotID`, `censusID`

Response:
- `updatedCount`: number of rows updated
- `insertedCount`: number of new rows created (via bulkingestionprocess)
- `skippedCount`: rows skipped (no changes detected)
- `validationErrors`: any validation errors found on updated rows

### UI Flow

The upload flow in `uploadparent.tsx` already uses `ReviewStates` to manage the multi-step wizard. Revision mode adds two new states:

1. **`REVISION_MATCH`** -- After file parsing (`UPLOAD_FILES`), sends parsed rows to `/api/revisionupload` for matching. Shows a summary: "X rows matched, Y rows are new." Displays unmatched rows in a table for review with confirm/skip controls.

2. **`REVISION_APPLY`** -- After user confirms, calls `/api/revisionupload/apply`. Shows progress, then transitions to `VALIDATE` (existing state) to run validations on updated rows.

The mode selector in `UploadStart` already shows the upload mode. For measurements with `REVISIONS` mode selected, the flow becomes:

```
START -> UPLOAD_FILES -> REVISION_MATCH -> REVISION_APPLY -> VALIDATE -> COMPLETE
```

vs. the existing flow:

```
START -> UPLOAD_FILES -> UPLOAD_SQL -> VALIDATE -> ... -> COMPLETE
```

### Component Changes

| Component | Change |
|-----------|--------|
| `uploadparent.tsx` | Add routing for `REVISION_MATCH` and `REVISION_APPLY` states when `uploadMode === REVISIONS` and `uploadForm === measurements` |
| `uploadstart.tsx` | No changes needed -- already displays upload mode |
| `uploadsystemmacros.ts` | Add `REVISION_MATCH` and `REVISION_APPLY` to `ReviewStates` enum |
| `formdetails.ts` | No changes needed -- existing header definitions are sufficient |
| New: `uploadrevisionmatch.tsx` | Matching results display, unmatched rows table, confirm/skip UI |
| New: `uploadrevisionapply.tsx` | Apply updates, show progress, transition to validation |
| New: `/api/revisionupload/route.ts` | Row matching logic |
| New: `/api/revisionupload/apply/route.ts` | UPDATE execution + new row pipeline routing |

## Testing

### Integration Tests

- Upload a revision CSV with `stemID` -- verify matched rows are updated, unmatched rows flagged
- Upload a revision CSV without `stemID` -- verify fallback to `tag` + `stemtag` matching
- Upload with only some columns populated -- verify non-empty merge (blank cells don't overwrite)
- Upload with extra/unknown columns -- verify they are silently ignored
- Upload with all rows matching -- verify no new-row confirmation prompt
- Upload with some unmatched rows -- verify review table appears, confirm creates new rows
- Upload with some unmatched rows -- verify rejecting skips them
- Verify validations run on updated rows and errors appear in `measurement_error_log`
- Verify `codes` column updates correctly rebuild `cmattributes` associations
- Verify `spcode` update changes the tree's `SpeciesID` via species lookup
- Verify `quadrat` update changes the stem's `QuadratID` via quadrat lookup

### Edge Cases

- CSV where every row is unmatched (effectively a new upload through revision mode)
- CSV where every row matches but no values changed (all skipped)
- Duplicate match keys in the CSV (should error, like species dedup check)
- `stemID` column present but all values empty (should fall back to `tag` + `stemtag`)
- Row matches by `stemID` but `tag`/`stemtag` in CSV differ from DB (update the tag/stemtag)
