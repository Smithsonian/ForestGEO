# Measurement Revision Upload - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a REVISIONS upload mode for measurements so researchers can export their census data, correct specific rows in a spreadsheet, and re-upload targeted corrections without re-running full-census ingestion.

**Architecture:** Phase 1 supports row-local measurement revisions (dbh, hom, date, codes, comments) matched by `measurementID` (CoreMeasurementID). Revision files are fully parsed into a staged `parsedData` row set before match review; matched rows are re-resolved inside the current plot+census during both match and apply. Apply is the authoritative conflict gate: it checks for active `upload_sessions` and `validation_runs` for the same plot/census, clears only validation-sourced `measurement_error_log` entries, routes confirmed new rows through `temporarymeasurements` -> `bulkingestionprocess`, and reruns validations on affected rows.

**Tech Stack:** Next.js 15 API routes, MySQL (mysql2/promise), React 19, MUI Joy, Vitest integration tests

**Spec:** `docs/superpowers/specs/2026-04-14-measurement-revision-upload-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|----------------|
| `frontend/app/api/revisionupload/route.ts` | Match/classify uploaded revision rows against existing coremeasurements |
| `frontend/app/api/revisionupload/apply/route.ts` | Apply direct UPDATEs for matched rows, route new rows through ingestion pipeline |
| `frontend/components/uploadsystem/segments/uploadrevisionmatch.tsx` | UI: display matched/new/invalid rows for review |
| `frontend/components/uploadsystem/segments/uploadrevisionapply.tsx` | UI: apply progress display, validation trigger |
| `frontend/tests/integration/revision-upload.integration.test.ts` | Integration tests for match + apply APIs |

### Modified Files
| File | Change |
|------|--------|
| `frontend/app/api/formdownload/[dataType]/[[...slugs]]/route.ts` | Add `measurementID` + `comments` columns to measurement export |
| `frontend/config/macros/uploadsystemmacros.ts` | Add `REVISION_MATCH`, `REVISION_APPLY` to `ReviewStates` enum |
| `frontend/components/uploadsystemhelpers/uploadparentmodal.tsx` | Enable mode selector for measurements |
| `frontend/config/macros/formdetails.ts` | Add `measurementID` as optional first measurement header for export order + revision uploads |
| `frontend/components/uploadsystem/uploadparent.tsx` | Parse/stage revision files and route revision states to new components |

---

### Task 0: Add measurementID and comments to measurement CSV export

**Goal:** Include `measurementID` (raw CoreMeasurementID) and `comments` in the measurement CSV export so researchers have round-trip-capable files.

**Files:**
- Modify: `frontend/app/api/formdownload/[dataType]/[[...slugs]]/route.ts:199-262`
- Modify: `frontend/config/macros/formdetails.ts:88-111`

**Acceptance Criteria:**
- [ ] Exported CSV contains `measurementID` column with raw CoreMeasurementID integer values
- [ ] Exported CSV contains `comments` column with Description values
- [ ] `measurementID` is the first measurement header in `TableHeadersByFormType`, so the form export writer emits it first
- [ ] `measurementID` is accepted as an optional measurement upload header for revision files

**Verify:** Start dev server, export measurements CSV, verify both columns present with correct values.

**Steps:**

- [ ] **Step 1: Add CoreMeasurementID and Description to the SELECT query**

In `frontend/app/api/formdownload/[dataType]/[[...slugs]]/route.ts`, the measurements case (line 199) builds a SELECT query. Add `cm.CoreMeasurementID` and `cm.Description`:

```typescript
      case 'measurements':
        query = `SELECT
                  cm.CoreMeasurementID                                  AS CoreMeasurementID,
                  st.StemGUID                                           AS StemGUID,
                  t.TreeID                                              AS TreeID,
                  st.StemTag                                            AS StemTag,
                  t.TreeTag                                             AS TreeTag,
                  sp.SpeciesCode                                        AS SpeciesCode,
                  q.QuadratName                                         AS QuadratName,
                  st.LocalX                                             AS StartX,
                  st.LocalY                                             AS StartY,
                  cm.MeasuredDBH                                        AS MeasuredDBH,
                  cm.MeasuredHOM                                        AS MeasuredHOM,
                  cm.MeasurementDate                                    AS MeasurementDate,
                  (
                    SELECT GROUP_CONCAT(ca.Code SEPARATOR '; ')
                    FROM ${schema}.cmattributes ca
                    WHERE ca.CoreMeasurementID = cm.CoreMeasurementID
                  ) as Codes,
                  cm.Description                                        AS Comments,
                  (SELECT GROUP_CONCAT(
                            COALESCE(
                              NULLIF(CONCAT_WS(': ', NULLIF(vp.ProcedureName, ''), NULLIF(vp.Description, '')), ''),
                              me.ErrorMessage
                            )
                            ORDER BY me.ErrorCode SEPARATOR '; '
                          )
                   FROM ${schema}.measurement_error_log mel
                   JOIN ${schema}.measurement_errors me ON me.ErrorID = mel.ErrorID
                   LEFT JOIN ${schema}.sitespecificvalidations vp ON me.ErrorCode = CAST(vp.ValidationID AS CHAR)
                   WHERE mel.MeasurementID = cm.CoreMeasurementID
                     AND me.ErrorSource = 'validation'
                     AND mel.IsResolved = FALSE) AS Errors
              FROM ${schema}.coremeasurements cm
              ...rest of query unchanged...`;
```

- [ ] **Step 2: Add measurementID and comments to the formMappedResults mapping**

Update the `formMappedResults` mapping (line 247) to include the new columns:

```typescript
        formMappedResults = results.map((row: any) => ({
          measurementID: row.CoreMeasurementID,
          stemID: row.StemGUID,
          treeID: row.TreeID,
          tag: row.TreeTag,
          stemtag: row.StemTag,
          spcode: row.SpeciesCode,
          quadrat: row.QuadratName,
          lx: row.StartX,
          ly: row.StartY,
          dbh: row.MeasuredDBH,
          hom: row.MeasuredHOM,
          date: row.MeasurementDate,
          codes: row.Codes,
          comments: row.Comments,
          errors: row.Errors
        }));
```

- [ ] **Step 3: Add `measurementID` as the first optional measurement header**

In `frontend/config/macros/formdetails.ts`, prepend `measurementID` to the measurements header list. This makes the CSV export writer emit it first because `measurementscommons.tsx` uses `getTableHeaders(FormType.measurements)` to build the form download column order.

```typescript
  [FormType.measurements]: [
    { label: 'measurementID', explanation: 'The unique measurement identifier (CoreMeasurementID) used for revision matching', category: 'optional' },
    { label: 'tag', explanation: 'Tag number on the tree in the field, should be unique within each plot.', category: 'required' },
    // ...rest unchanged
  ],
```

`comments` is already present in the measurement header list; no additional header work is needed for that column.

- [ ] **Step 4: Verify the build compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add frontend/app/api/formdownload/[dataType]/[[...slugs]]/route.ts frontend/config/macros/formdetails.ts
git commit -m "Add measurementID and comments columns to measurement CSV export"
```

---

### Task 1: Enable measurement REVISIONS mode + add ReviewStates

**Goal:** Enable the upload mode selector for measurements and add revision-specific review states to the upload flow.

**Files:**
- Modify: `frontend/config/macros/uploadsystemmacros.ts:165-189`
- Modify: `frontend/components/uploadsystemhelpers/uploadparentmodal.tsx:19-40`

**Acceptance Criteria:**
- [ ] `REVISION_MATCH` and `REVISION_APPLY` added to `ReviewStates` and `ReviewProgress`
- [ ] Upload modal shows mode selector for measurements
- [ ] `getRevisionMatchLabel` returns `'measurementID'` for measurements

**Verify:** Start dev server, open measurement upload modal, verify mode selector appears.

**Steps:**

- [ ] **Step 1: Add REVISION_MATCH and REVISION_APPLY to ReviewStates**

In `frontend/config/macros/uploadsystemmacros.ts`, add two new states to the `ReviewStates` enum:

```typescript
export enum ReviewStates {
  START = 'start',
  UPLOAD_FILES = 'upload_files',
  REVIEW = 'review',
  UPLOAD_SQL = 'upload_sql',
  REVISION_MATCH = 'revision_match',
  REVISION_APPLY = 'revision_apply',
  VALIDATE = 'validate',
  VALIDATE_ERRORS_FOUND = 'validate_errors_found',
  UPDATE = 'update_rows',
  UPLOAD_AZURE = 'upload_azure',
  COMPLETE = 'complete',
  ERRORS = 'errors',
  FILE_MISMATCH_ERROR = 'file_mismatch_error'
}
```

Also add to `ReviewProgress`:

```typescript
export enum ReviewProgress {
  START = 1,
  UPLOAD_FILES = 2,
  REVIEW = 3,
  UPLOAD_SQL = 4,
  REVISION_MATCH = 5,
  REVISION_APPLY = 6,
  VALIDATE = 7,
  VALIDATE_ERRORS_FOUND = 8,
  UPDATE = 9,
  UPLOAD_AZURE = 10,
  COMPLETE = 11
}
```

- [ ] **Step 2: Enable mode selector for measurements in uploadparentmodal.tsx**

In `frontend/components/uploadsystemhelpers/uploadparentmodal.tsx`, change line 38 to remove the measurements exclusion:

```typescript
// Before:
const requiresModeSelection = !skipToProcessing && formType !== FormType.measurements;

// After:
const requiresModeSelection = !skipToProcessing;
```

Update `getRevisionMatchLabel` (line 29) to return the Phase 1 match key:

```typescript
    case FormType.measurements:
      return 'measurementID';
```

- [ ] **Step 3: Verify the build compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add frontend/config/macros/uploadsystemmacros.ts frontend/components/uploadsystemhelpers/uploadparentmodal.tsx
git commit -m "Enable measurement REVISIONS mode and add revision ReviewStates"
```

---

### Task 2: Build revision match/classify API (POST /api/revisionupload)

**Goal:** Build the API route that receives parsed revision CSV rows, matches them against existing `coremeasurements` by `measurementID`, and classifies them into matched revisions, new row candidates, and invalid rows.

**Files:**
- Create: `frontend/app/api/revisionupload/route.ts`

**Acceptance Criteria:**
- [ ] Rows with valid measurementID matching active census row in the current plot (StemGUID IS NOT NULL) -> matched
- [ ] Rows with measurementID pointing to StemGUID IS NULL -> invalid (failed measurement)
- [ ] Rows with measurementID found in the census but outside the current plot -> invalid (wrong plot)
- [ ] Rows with measurementID not found in census -> invalid (not found)
- [ ] Rows with blank measurementID + all required insert fields -> new candidate
- [ ] Rows with blank measurementID + missing required fields -> invalid (incomplete)
- [ ] Duplicate measurementIDs in file -> entire file rejected with error
- [ ] Matched rows include computed diff of changed fields
- [ ] Optional advisory conflict check against active upload sessions for same plot/census (apply re-checks authoritatively)

**Verify:** `cd frontend && npm run test:integration` (after Task 6 tests are written)

**Steps:**

- [ ] **Step 1: Create the route file with request validation**

Create `frontend/app/api/revisionupload/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import ConnectionManager from '@/config/connectionmanager';
import { isValidSchema, safeFormatQuery } from '@/config/utils/sqlsecurity';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';
import { FileRow } from '@/config/macros/formdetails';

export const runtime = 'nodejs';

/** Phase 1 updatable fields (row-local measurement data only). */
const UPDATABLE_FIELDS = ['dbh', 'hom', 'date', 'codes', 'comments'] as const;

/** Required fields for inserting a brand-new measurement row. */
const REQUIRED_INSERT_FIELDS = ['tag', 'spcode', 'quadrat', 'lx', 'ly', 'date'] as const;

interface RevisionMatchedRow {
  csvRow: FileRow;
  coreMeasurementID: number;
  existingValues: {
    measuredDBH: number | null;
    measuredHOM: number | null;
    measurementDate: string | null;
    rawCodes: string | null;
    description: string | null;
  };
  changes: Record<string, { from: unknown; to: unknown }>;
}

interface RevisionNewRow {
  csvRow: FileRow;
  csvIndex: number;
}

interface RevisionInvalidRow {
  csvRow: FileRow;
  csvIndex: number;
  reason: string;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: 'Unauthorized - authentication required' },
      { status: HTTPResponses.UNAUTHORIZED }
    );
  }

  let body: { rows: FileRow[]; plotID: number; censusID: number; schema: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid or empty JSON body' },
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }

  const { rows, plotID, censusID, schema } = body;

  if (!isValidSchema(schema)) {
    return NextResponse.json({ error: 'Invalid schema' }, { status: HTTPResponses.INVALID_REQUEST });
  }
  if (!plotID || !censusID || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json(
      { error: 'Missing required fields: rows, plotID, censusID' },
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }

  // --- Duplicate measurementID check ---
  const seenMeasurementIDs = new Set<string>();
  const duplicates: string[] = [];
  for (const row of rows) {
    const mid = row.measurementID?.toString().trim();
    if (mid) {
      if (seenMeasurementIDs.has(mid)) {
        duplicates.push(mid);
      }
      seenMeasurementIDs.add(mid);
    }
  }
  if (duplicates.length > 0) {
    return NextResponse.json(
      { error: `Duplicate measurementID values in file: ${[...new Set(duplicates)].join(', ')}` },
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }

  const connectionManager = ConnectionManager.getInstance();

  try {
    const matchedRows: RevisionMatchedRow[] = [];
    const newRows: RevisionNewRow[] = [];
    const invalidRows: RevisionInvalidRow[] = [];

    for (let i = 0; i < rows.length; i++) {
      const csvRow = rows[i];
      const measurementID = csvRow.measurementID?.toString().trim();

      if (measurementID) {
        // --- Existing-row revision: resolve by CoreMeasurementID ---
        const parsedID = parseInt(measurementID, 10);
        if (isNaN(parsedID)) {
          invalidRows.push({ csvRow, csvIndex: i, reason: `measurementID "${measurementID}" is not a valid integer` });
          continue;
        }

        const query = safeFormatQuery(
          schema,
          `SELECT cm.CoreMeasurementID, cm.StemGUID, cm.MeasuredDBH, cm.MeasuredHOM,
                  cm.MeasurementDate, cm.RawCodes, cm.Description,
                  q.PlotID AS ResolvedPlotID
           FROM ??.coremeasurements cm
           LEFT JOIN ??.stems st
             ON st.StemGUID = cm.StemGUID AND st.CensusID = cm.CensusID AND st.IsActive = 1
           LEFT JOIN ??.quadrats q
             ON q.QuadratID = st.QuadratID AND q.IsActive = 1
           WHERE cm.CoreMeasurementID = ? AND cm.CensusID = ? AND cm.IsActive = 1`
        );
        const results = await connectionManager.executeQuery(query, [parsedID, censusID]);

        if (results.length === 0) {
          invalidRows.push({ csvRow, csvIndex: i, reason: `measurementID ${parsedID} not found in the active census` });
          continue;
        }

        const existing = results[0];
        if (existing.StemGUID === null) {
          invalidRows.push({
            csvRow,
            csvIndex: i,
            reason: `measurementID ${parsedID} is a failed/unresolved measurement (use re-ingestion workflow instead)`
          });
          continue;
        }

        if (existing.ResolvedPlotID !== plotID) {
          invalidRows.push({
            csvRow,
            csvIndex: i,
            reason: `measurementID ${parsedID} belongs to a different plot in this census`
          });
          continue;
        }

        // Compute diff: which Phase 1 fields actually changed?
        const existingValues = {
          measuredDBH: existing.MeasuredDBH,
          measuredHOM: existing.MeasuredHOM,
          measurementDate: existing.MeasurementDate ? new Date(existing.MeasurementDate).toISOString().split('T')[0] : null,
          rawCodes: existing.RawCodes,
          description: existing.Description
        };

        const changes: Record<string, { from: unknown; to: unknown }> = {};
        const fieldMap: Record<string, keyof typeof existingValues> = {
          dbh: 'measuredDBH',
          hom: 'measuredHOM',
          date: 'measurementDate',
          codes: 'rawCodes',
          comments: 'description'
        };

        for (const field of UPDATABLE_FIELDS) {
          const csvValue = csvRow[field]?.toString().trim();
          if (csvValue !== undefined && csvValue !== null && csvValue !== '') {
            const existingKey = fieldMap[field];
            const existingVal = existingValues[existingKey];
            const existingStr = existingVal !== null && existingVal !== undefined ? String(existingVal) : '';
            if (csvValue !== existingStr) {
              changes[field] = { from: existingVal, to: csvValue };
            }
          }
        }

        matchedRows.push({ csvRow, coreMeasurementID: parsedID, existingValues, changes });
      } else {
        // --- No measurementID: check if valid new-row candidate ---
        const missingFields = REQUIRED_INSERT_FIELDS.filter(f => {
          const val = csvRow[f]?.toString().trim();
          return !val;
        });

        if (missingFields.length > 0) {
          invalidRows.push({
            csvRow,
            csvIndex: i,
            reason: `Missing required fields for new measurement: ${missingFields.join(', ')}`
          });
        } else {
          newRows.push({ csvRow, csvIndex: i });
        }
      }
    }

    return NextResponse.json({
      matchedRows,
      newRows,
      invalidRows,
      counts: {
        matched: matchedRows.length,
        matchedWithChanges: matchedRows.filter(r => Object.keys(r.changes).length > 0).length,
        new: newRows.length,
        invalid: invalidRows.length,
        total: rows.length
      }
    });
  } catch (err: any) {
    ailogger.error('[revisionupload] Error classifying revision rows:', err);
    return NextResponse.json(
      { error: `Failed to classify revision rows: ${err.message}` },
      { status: HTTPResponses.SERVER_ERROR }
    );
  }
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add frontend/app/api/revisionupload/route.ts
git commit -m "Add revision match/classify API route (POST /api/revisionupload)"
```

---

### Task 3: Build revision apply API (POST /api/revisionupload/apply)

**Goal:** Build the API route that applies direct UPDATEs for matched revision rows, routes confirmed new rows through the existing ingestion pipeline, resets validation state, and triggers the validation runner.

**Files:**
- Create: `frontend/app/api/revisionupload/apply/route.ts`

**Acceptance Criteria:**
- [ ] Matched rows: direct UPDATE on coremeasurements with non-destructive merge
- [ ] `codes` updates: overwrite `RawCodes` + delete/re-insert `cmattributes`
- [ ] `comments` updates: overwrite both `Description` and `RawComments`
- [ ] Preserve original `UploadFileID` and `UploadBatchID`
- [ ] Reset `IsValidated` to NULL on updated rows
- [ ] Clear only validation-sourced `measurement_error_log` entries for updated rows
- [ ] Confirmed new rows: INSERT into `temporarymeasurements` then CALL `bulkingestionprocess`
- [ ] Reject/409 when active `upload_sessions` or `validation_runs` already own the same plot/census scope
- [ ] Unique constraint violations surfaced as apply errors
- [ ] Re-resolve rows at apply time within the current plot+census boundary (TOCTOU protection)

**Verify:** `cd frontend && npm run test:integration`

**Steps:**

- [ ] **Step 1: Create the apply route with update logic**

Create `frontend/app/api/revisionupload/apply/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import ConnectionManager from '@/config/connectionmanager';
import { isValidSchema, safeFormatQuery } from '@/config/utils/sqlsecurity';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';
import { FileRow } from '@/config/macros/formdetails';
import { generateShortBatchID } from '@/config/utils';

export const runtime = 'nodejs';

interface MatchedRowPayload {
  coreMeasurementID: number;
  csvRow: FileRow;
}

class RevisionApplyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RevisionApplyConflictError';
  }
}

/**
 * Parse a semicolon-separated codes string into an array of trimmed, non-empty codes.
 */
function parseCodes(codesStr: string): string[] {
  return codesStr
    .split(';')
    .map(c => c.trim())
    .filter(c => c.length > 0);
}

/**
 * Normalize a date string to YYYY-MM-DD format for MySQL.
 * Handles common formats: YYYY-MM-DD, MM/DD/YYYY, M/D/YYYY.
 */
function normalizeDateForSQL(dateStr: string): string {
  // If already YYYY-MM-DD, return as-is
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;

  // Try parsing as a date
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }

  // Return raw value and let MySQL handle/reject it
  return dateStr;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: 'Unauthorized - authentication required' },
      { status: HTTPResponses.UNAUTHORIZED }
    );
  }

  let body: {
    matchedRows: MatchedRowPayload[];
    newRows: FileRow[];
    confirmNewRows: boolean;
    schema: string;
    plotID: number;
    censusID: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid or empty JSON body' },
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }

  const { matchedRows, newRows, confirmNewRows, schema, plotID, censusID } = body;

  if (!isValidSchema(schema)) {
    return NextResponse.json({ error: 'Invalid schema' }, { status: HTTPResponses.INVALID_REQUEST });
  }
  if (!plotID || !censusID) {
    return NextResponse.json(
      { error: 'Missing required fields: plotID, censusID' },
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }

  const connectionManager = ConnectionManager.getInstance();
  let updatedCount = 0;
  let skippedCount = 0;
  let insertedCount = 0;
  const applyErrors: Array<{ coreMeasurementID: number; error: string }> = [];

  try {
    // Use withTransaction for automatic rollback on error
    await connectionManager.withTransaction(async transactionID => {
      // Apply is the authoritative scope gate. Re-check conflicts here even if
      // the match step already performed an advisory preflight.
      //
      // 1. Query upload_sessions for the same plot/census using the same
      //    active-state + heartbeat freshness rules as uploadsessiontracker.
      // 2. Query validation_runs using SELECT ... FOR UPDATE, mirroring
      //    /api/validations/run.
      // 3. If either scope owner is active, return HTTP 409 and abort apply.
      const activeUploadSessionQuery = safeFormatQuery(
        schema,
        `SELECT session_id
         FROM ??.upload_sessions
         WHERE plot_id = ? AND census_id = ?
           AND state IN ('initialized', 'uploading', 'uploaded', 'processing', 'collapsing')
           AND last_heartbeat >= DATE_SUB(NOW(), INTERVAL 2 MINUTE)
         ORDER BY last_heartbeat DESC, updated_at DESC
         LIMIT 1
         FOR UPDATE`
      );
      const activeUploadSessions = await connectionManager.executeQuery(activeUploadSessionQuery, [plotID, censusID], transactionID);
      if (activeUploadSessions.length > 0) {
        throw new RevisionApplyConflictError('Revision apply blocked: another upload session is active for this plot/census');
      }

      const activeValidationQuery = safeFormatQuery(
        schema,
        `SELECT RunID
         FROM ??.validation_runs
         WHERE PlotID = ? AND CensusID = ? AND Status = 'running'
         ORDER BY RunID DESC
         LIMIT 1
         FOR UPDATE`
      );
      const activeValidationRuns = await connectionManager.executeQuery(activeValidationQuery, [plotID, censusID], transactionID);
      if (activeValidationRuns.length > 0) {
        throw new RevisionApplyConflictError('Revision apply blocked: validation is already running for this plot/census');
      }

      // --- Phase 1: Apply direct updates to matched rows ---
      for (const { coreMeasurementID, csvRow } of matchedRows ?? []) {
        // TOCTOU: Re-resolve the row to confirm it still exists and still
        // belongs to the current plot/census scope.
        const resolveQuery = safeFormatQuery(
          schema,
          `SELECT cm.CoreMeasurementID, cm.StemGUID, q.PlotID AS ResolvedPlotID
           FROM ??.coremeasurements cm
           LEFT JOIN ??.stems st
             ON st.StemGUID = cm.StemGUID AND st.CensusID = cm.CensusID AND st.IsActive = 1
           LEFT JOIN ??.quadrats q
             ON q.QuadratID = st.QuadratID AND q.IsActive = 1
           WHERE cm.CoreMeasurementID = ? AND cm.CensusID = ? AND cm.IsActive = 1`
        );
        const resolved = await connectionManager.executeQuery(resolveQuery, [coreMeasurementID, censusID], transactionID);
        if (resolved.length === 0) {
          applyErrors.push({ coreMeasurementID, error: 'Row no longer exists in this census' });
          continue;
        }

        const resolvedRow = resolved[0];
        if (resolvedRow.StemGUID === null) {
          applyErrors.push({ coreMeasurementID, error: 'Row is now a failed measurement and must use the re-ingestion workflow' });
          continue;
        }
        if (resolvedRow.ResolvedPlotID !== plotID) {
          applyErrors.push({ coreMeasurementID, error: 'Row no longer belongs to the current plot' });
          continue;
        }

        // Build SET clauses from non-empty CSV fields (non-destructive merge)
        const setClauses: string[] = [];
        const setValues: (string | number | null)[] = [];

        const dbhVal = csvRow.dbh?.toString().trim();
        if (dbhVal) {
          setClauses.push('MeasuredDBH = ?');
          setValues.push(parseFloat(dbhVal));
        }

        const homVal = csvRow.hom?.toString().trim();
        if (homVal) {
          setClauses.push('MeasuredHOM = ?');
          setValues.push(parseFloat(homVal));
        }

        const dateVal = csvRow.date?.toString().trim();
        if (dateVal) {
          setClauses.push('MeasurementDate = ?');
          setValues.push(normalizeDateForSQL(dateVal));
        }

        const codesVal = csvRow.codes?.toString().trim();
        if (codesVal !== undefined && codesVal !== null && codesVal !== '') {
          setClauses.push('RawCodes = ?');
          setValues.push(codesVal);
        }

        const commentsVal = csvRow.comments?.toString().trim();
        if (commentsVal !== undefined && commentsVal !== null && commentsVal !== '') {
          setClauses.push('Description = ?', 'RawComments = ?');
          setValues.push(commentsVal, commentsVal);
        }

        if (setClauses.length === 0) {
          skippedCount++;
          continue;
        }

        // Always reset IsValidated so validation re-runs on this row
        setClauses.push('IsValidated = NULL');

        const updateQuery = safeFormatQuery(
          schema,
          `UPDATE ??.coremeasurements SET ${setClauses.join(', ')} WHERE CoreMeasurementID = ?`
        );
        setValues.push(coreMeasurementID);

        try {
          await connectionManager.executeQuery(updateQuery, setValues, transactionID);
        } catch (err: any) {
          if (err.code === 'ER_DUP_ENTRY') {
            applyErrors.push({
              coreMeasurementID,
              error: 'Update would create a duplicate measurement (same StemGUID + CensusID + Date + DBH + HOM)'
            });
            continue;
          }
          throw err;
        }

        // If codes changed, rebuild cmattributes
        if (codesVal !== undefined && codesVal !== null && codesVal !== '') {
          // Delete existing attribute associations
          const deleteAttrsQuery = safeFormatQuery(
            schema,
            'DELETE FROM ??.cmattributes WHERE CoreMeasurementID = ?'
          );
          await connectionManager.executeQuery(deleteAttrsQuery, [coreMeasurementID], transactionID);

          // Re-insert from the new codes value
          const codes = parseCodes(codesVal);
          if (codes.length > 0) {
            const placeholders = codes.map(() => '(?, ?)').join(', ');
            const insertValues = codes.flatMap(code => [coreMeasurementID, code]);
            const insertAttrsQuery = safeFormatQuery(
              schema,
              `INSERT IGNORE INTO ??.cmattributes (CoreMeasurementID, Code) VALUES ${placeholders}`
            );
            await connectionManager.executeQuery(insertAttrsQuery, insertValues, transactionID);
          }
        }

        // Clear only validation-owned errors for this row; preserve ingestion
        // and failure history.
        const clearErrorsQuery = safeFormatQuery(
          schema,
          `DELETE mel
           FROM ??.measurement_error_log mel
           JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
           WHERE mel.MeasurementID = ? AND me.ErrorSource = 'validation'`
        );
        await connectionManager.executeQuery(clearErrorsQuery, [coreMeasurementID], transactionID);

        updatedCount++;
      }

      // --- Phase 2: Insert confirmed new rows through existing pipeline ---
      if (confirmNewRows && newRows && newRows.length > 0) {
        const batchID = generateShortBatchID();
        const insertPrefix = safeFormatQuery(
          schema,
          `INSERT IGNORE INTO ??.temporarymeasurements
           (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode,
            QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate, Codes, Comments)
           VALUES `
        );

        const placeholders = newRows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
        const values = newRows.flatMap(row => [
          'revision-upload',  // FileID
          batchID,
          plotID,
          censusID,
          row.tag?.toString().trim() ?? null,
          row.stemtag?.toString().trim() || null,
          row.spcode?.toString().trim() ?? null,
          row.quadrat?.toString().trim() ?? null,
          row.lx ? parseFloat(row.lx.toString()) : null,
          row.ly ? parseFloat(row.ly.toString()) : null,
          row.dbh?.toString().trim() || null,
          row.hom?.toString().trim() || null,
          row.date ? normalizeDateForSQL(row.date.toString().trim()) : null,
          row.codes?.toString().trim() || null,
          row.comments?.toString().trim() || null
        ]);

        await connectionManager.executeQuery(`${insertPrefix}${placeholders}`, values, transactionID);

        // Call bulkingestionprocess for the new rows
        const callQuery = safeFormatQuery(
          schema,
          'CALL ??.bulkingestionprocess(?, ?, ?)'
        );
        await connectionManager.executeQuery(callQuery, [plotID, censusID, batchID], transactionID);

        insertedCount = newRows.length;
      }
    });

    return NextResponse.json({
      updatedCount,
      skippedCount,
      insertedCount,
      applyErrors,
      validationPending: updatedCount > 0 || insertedCount > 0
    });
  } catch (err: any) {
    ailogger.error('[revisionupload/apply] Error applying revisions:', err);
    const status = err?.name === 'RevisionApplyConflictError' ? HTTPResponses.CONFLICT : HTTPResponses.SERVER_ERROR;
    return NextResponse.json(
      { error: `Failed to apply revisions: ${err.message}` },
      { status }
    );
  }
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add frontend/app/api/revisionupload/apply/route.ts
git commit -m "Add revision apply API route (POST /api/revisionupload/apply)"
```

---

### Task 4: Build revision match review UI component

**Goal:** Build the `uploadrevisionmatch.tsx` component that displays classified revision rows for user review before applying.

**Files:**
- Create: `frontend/components/uploadsystem/segments/uploadrevisionmatch.tsx`

**Acceptance Criteria:**
- [ ] Summary counts displayed (matched with changes, matched no changes, new candidates, invalid)
- [ ] Matched rows shown in a table with old/new value columns for changed fields
- [ ] New row candidates shown in a table for review
- [ ] Invalid rows shown with error reasons
- [ ] "Apply Revisions" button proceeds to REVISION_APPLY state
- [ ] "Cancel" button returns to START

**Verify:** Dev server -> upload a revision CSV in REVISIONS mode -> verify review UI renders

**Steps:**

- [ ] **Step 1: Create the component**

Create `frontend/components/uploadsystem/segments/uploadrevisionmatch.tsx`.

The component receives the match API response and renders three sections:

```typescript
'use client';

import React, { useState } from 'react';
import { Box, Button, Chip, Sheet, Stack, Tab, TabList, TabPanel, Table, Tabs, Typography } from '@mui/joy';
import { ReviewStates } from '@/config/macros/uploadsystemmacros';
import { FileRow } from '@/config/macros/formdetails';

interface MatchedRow {
  csvRow: FileRow;
  coreMeasurementID: number;
  existingValues: Record<string, unknown>;
  changes: Record<string, { from: unknown; to: unknown }>;
}

interface NewRow {
  csvRow: FileRow;
  csvIndex: number;
}

interface InvalidRow {
  csvRow: FileRow;
  csvIndex: number;
  reason: string;
}

interface RevisionMatchCounts {
  matched: number;
  matchedWithChanges: number;
  new: number;
  invalid: number;
  total: number;
}

interface UploadRevisionMatchProps {
  matchedRows: MatchedRow[];
  newRows: NewRow[];
  invalidRows: InvalidRow[];
  counts: RevisionMatchCounts;
  schema: string;
  plotID: number;
  censusID: number;
  setReviewState: (state: ReviewStates) => void;
  onApply: (confirmNewRows: boolean) => void;
  handleReturnToStart: () => Promise<void>;
}

export default function UploadRevisionMatch({
  matchedRows,
  newRows,
  invalidRows,
  counts,
  setReviewState,
  onApply,
  handleReturnToStart
}: UploadRevisionMatchProps) {
  const [confirmNewRows, setConfirmNewRows] = useState(false);
  const rowsWithChanges = matchedRows.filter(r => Object.keys(r.changes).length > 0);
  const rowsNoChanges = matchedRows.filter(r => Object.keys(r.changes).length === 0);

  const canApply = rowsWithChanges.length > 0 || (confirmNewRows && newRows.length > 0);

  return (
    <Stack spacing={3} sx={{ width: '100%' }}>
      <Typography level="h4">Revision Upload Review</Typography>

      {/* Summary chips */}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Chip color="success" variant="soft">{counts.matchedWithChanges} rows to update</Chip>
        <Chip color="neutral" variant="soft">{counts.matched - counts.matchedWithChanges} rows unchanged</Chip>
        <Chip color="warning" variant="soft">{counts.new} new rows</Chip>
        {counts.invalid > 0 && <Chip color="danger" variant="soft">{counts.invalid} invalid rows</Chip>}
      </Box>

      <Tabs defaultValue="matched">
        <TabList>
          <Tab value="matched">Changes ({rowsWithChanges.length})</Tab>
          {newRows.length > 0 && <Tab value="new">New Rows ({newRows.length})</Tab>}
          {invalidRows.length > 0 && <Tab value="invalid">Invalid ({invalidRows.length})</Tab>}
          {rowsNoChanges.length > 0 && <Tab value="unchanged">Unchanged ({rowsNoChanges.length})</Tab>}
        </TabList>

        {/* Matched rows with changes */}
        <TabPanel value="matched">
          <Sheet variant="outlined" sx={{ borderRadius: 'sm', overflow: 'auto', maxHeight: 400 }}>
            <Table stickyHeader size="sm">
              <thead>
                <tr>
                  <th>measurementID</th>
                  <th>Field</th>
                  <th>Current Value</th>
                  <th>New Value</th>
                </tr>
              </thead>
              <tbody>
                {rowsWithChanges.flatMap(row =>
                  Object.entries(row.changes).map(([field, { from, to }]) => (
                    <tr key={`${row.coreMeasurementID}-${field}`}>
                      <td>{row.coreMeasurementID}</td>
                      <td>{field}</td>
                      <td>{from !== null && from !== undefined ? String(from) : '(empty)'}</td>
                      <td><strong>{String(to)}</strong></td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </Sheet>
        </TabPanel>

        {/* New row candidates */}
        {newRows.length > 0 && (
          <TabPanel value="new">
            <Stack spacing={2}>
              <Typography level="body-sm">
                These rows have no measurementID and will be created as new measurements.
                Check the box below to confirm you want to insert them.
              </Typography>
              <Sheet variant="outlined" sx={{ borderRadius: 'sm', overflow: 'auto', maxHeight: 400 }}>
                <Table stickyHeader size="sm">
                  <thead>
                    <tr>
                      <th>tag</th>
                      <th>stemtag</th>
                      <th>spcode</th>
                      <th>quadrat</th>
                      <th>dbh</th>
                      <th>date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {newRows.map(({ csvRow, csvIndex }) => (
                      <tr key={csvIndex}>
                        <td>{csvRow.tag}</td>
                        <td>{csvRow.stemtag}</td>
                        <td>{csvRow.spcode}</td>
                        <td>{csvRow.quadrat}</td>
                        <td>{csvRow.dbh}</td>
                        <td>{csvRow.date}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Sheet>
              <Box>
                <Button
                  variant={confirmNewRows ? 'solid' : 'outlined'}
                  color={confirmNewRows ? 'success' : 'neutral'}
                  onClick={() => setConfirmNewRows(!confirmNewRows)}
                >
                  {confirmNewRows ? 'New rows will be inserted' : 'Confirm new row insertion'}
                </Button>
              </Box>
            </Stack>
          </TabPanel>
        )}

        {/* Invalid rows */}
        {invalidRows.length > 0 && (
          <TabPanel value="invalid">
            <Sheet variant="outlined" sx={{ borderRadius: 'sm', overflow: 'auto', maxHeight: 400 }}>
              <Table stickyHeader size="sm">
                <thead>
                  <tr>
                    <th>Row #</th>
                    <th>measurementID</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {invalidRows.map(({ csvRow, csvIndex, reason }) => (
                    <tr key={csvIndex}>
                      <td>{csvIndex + 1}</td>
                      <td>{csvRow.measurementID || '(blank)'}</td>
                      <td>{reason}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Sheet>
          </TabPanel>
        )}

        {/* Unchanged rows */}
        {rowsNoChanges.length > 0 && (
          <TabPanel value="unchanged">
            <Typography level="body-sm">
              These rows matched existing measurements but had no value changes. They will be skipped.
            </Typography>
          </TabPanel>
        )}
      </Tabs>

      {/* Action buttons */}
      <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
        <Button variant="outlined" color="neutral" onClick={handleReturnToStart}>
          Cancel
        </Button>
        <Button
          color="primary"
          disabled={!canApply}
          onClick={() => onApply(confirmNewRows)}
        >
          Apply {rowsWithChanges.length} Update{rowsWithChanges.length !== 1 ? 's' : ''}
          {confirmNewRows && newRows.length > 0 ? ` + ${newRows.length} New` : ''}
        </Button>
      </Box>
    </Stack>
  );
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add frontend/components/uploadsystem/segments/uploadrevisionmatch.tsx
git commit -m "Add revision match review UI component"
```

---

### Task 5: Build revision apply UI + wire upload parent routing

**Goal:** Build the `uploadrevisionapply.tsx` component and wire the complete revision flow into `uploadparent.tsx`.

**Files:**
- Create: `frontend/components/uploadsystem/segments/uploadrevisionapply.tsx`
- Modify: `frontend/components/uploadsystem/uploadparent.tsx:1-330`

**Acceptance Criteria:**
- [ ] `uploadparent.tsx` routes `REVISION_MATCH` -> `UploadRevisionMatch` component
- [ ] `uploadparent.tsx` routes `REVISION_APPLY` -> `UploadRevisionApply` component
- [ ] In REVISIONS mode, `handleInitialSubmit` fully parses/stages the selected files into `parsedData` before entering `REVISION_MATCH`
- [ ] `handleRevisionMatch` reads from staged `parsedData`, not preview-only file metadata
- [ ] Apply component calls `/api/revisionupload/apply`, shows progress
- [ ] After apply, triggers background validation and transitions to `UPLOAD_AZURE`
- [ ] Full flow: `START -> UPLOAD_FILES -> REVISION_MATCH -> REVISION_APPLY -> UPLOAD_AZURE -> COMPLETE`

**Verify:** Dev server -> full revision upload flow from file selection through completion

**Steps:**

- [ ] **Step 1: Create uploadrevisionapply.tsx**

Create `frontend/components/uploadsystem/segments/uploadrevisionapply.tsx`:

```typescript
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, CircularProgress, Stack, Typography } from '@mui/joy';
import { ReviewStates } from '@/config/macros/uploadsystemmacros';
import { useBackgroundValidation } from '@/app/hooks/usebackgroundvalidation';
import { useOrgCensusContext, usePlotContext } from '@/app/contexts/compat-hooks';
import { FileRow } from '@/config/macros/formdetails';
import ailogger from '@/ailogger';

interface MatchedRowPayload {
  coreMeasurementID: number;
  csvRow: FileRow;
}

interface UploadRevisionApplyProps {
  matchedRows: MatchedRowPayload[];
  newRows: FileRow[];
  confirmNewRows: boolean;
  schema: string;
  setReviewState: (state: ReviewStates) => void;
  setIsDataUnsaved: (unsaved: boolean) => void;
}

type ApplyStatus = 'applying' | 'success' | 'error';

export default function UploadRevisionApply({
  matchedRows,
  newRows,
  confirmNewRows,
  schema,
  setReviewState,
  setIsDataUnsaved
}: UploadRevisionApplyProps) {
  const [status, setStatus] = useState<ApplyStatus>('applying');
  const [statusMessage, setStatusMessage] = useState('Applying revisions...');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const hasApplied = useRef(false);

  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const plotID = currentPlot?.plotID ?? null;
  const censusID = currentCensus?.dateRanges?.[0]?.censusID ?? null;
  const { startValidation } = useBackgroundValidation();

  const applyRevisions = useCallback(async () => {
    if (hasApplied.current) return;
    hasApplied.current = true;

    try {
      const response = await fetch('/api/revisionupload/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matchedRows,
          newRows: confirmNewRows ? newRows : [],
          confirmNewRows,
          schema,
          plotID,
          censusID
        })
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(body.error || `Apply failed with status ${response.status}`);
      }

      const result = await response.json();

      setStatus('success');
      const parts: string[] = [];
      if (result.updatedCount > 0) parts.push(`${result.updatedCount} row(s) updated`);
      if (result.insertedCount > 0) parts.push(`${result.insertedCount} new row(s) inserted`);
      if (result.skippedCount > 0) parts.push(`${result.skippedCount} row(s) skipped (no changes)`);
      if (result.applyErrors?.length > 0) parts.push(`${result.applyErrors.length} row(s) had errors`);
      setStatusMessage(parts.join(', ') || 'No changes applied');

      // Trigger background validation
      if (result.validationPending && schema && plotID && censusID) {
        startValidation({ schema, plotID, censusID });
      }

      setIsDataUnsaved(false);

      // Transition to UPLOAD_AZURE after a brief pause so user can read results
      setTimeout(() => {
        setReviewState(ReviewStates.UPLOAD_AZURE);
      }, 2000);
    } catch (err: any) {
      ailogger.error('[UploadRevisionApply] Error applying revisions:', err);
      setStatus('error');
      setErrorMessage(err.message);
    }
  }, [matchedRows, newRows, confirmNewRows, schema, plotID, censusID, startValidation, setReviewState, setIsDataUnsaved]);

  useEffect(() => {
    applyRevisions();
  }, [applyRevisions]);

  return (
    <Stack spacing={2} sx={{ width: '100%', alignItems: 'center', py: 4 }}>
      {status === 'applying' && (
        <>
          <CircularProgress size="lg" />
          <Typography level="title-md">{statusMessage}</Typography>
        </>
      )}
      {status === 'success' && (
        <>
          <Typography level="title-md" color="success">
            Revisions Applied
          </Typography>
          <Typography level="body-sm">{statusMessage}</Typography>
          <Typography level="body-xs" color="neutral">
            Running validations in the background...
          </Typography>
        </>
      )}
      {status === 'error' && (
        <Box>
          <Typography level="title-md" color="danger">
            Error Applying Revisions
          </Typography>
          <Typography level="body-sm">{errorMessage}</Typography>
        </Box>
      )}
    </Stack>
  );
}
```

- [ ] **Step 2: Wire revision states into uploadparent.tsx**

In `frontend/components/uploadsystem/uploadparent.tsx`, add the following changes:

**Add imports** at the top:

```typescript
import UploadRevisionMatch from '@/components/uploadsystem/segments/uploadrevisionmatch';
import UploadRevisionApply from '@/components/uploadsystem/segments/uploadrevisionapply';
import Papa from 'papaparse';
```

**Add state for revision data** alongside existing state variables (near line 58):

```typescript
const [revisionMatchResult, setRevisionMatchResult] = useState<any>(null);
const [revisionConfirmNewRows, setRevisionConfirmNewRows] = useState(false);
```

**Add explicit revision file staging helpers** before `handleInitialSubmit`. `UploadParseFiles` only validates headers and previews files; it does not populate `parsedData`, so revision mode must do that itself:

```typescript
  async function parseRevisionFile(file: File, delimiter?: string): Promise<Record<string, FileRow>> {
    return new Promise((resolve, reject) => {
      Papa.parse<FileRow>(file, {
        header: true,
        skipEmptyLines: true,
        delimiter,
        complete: results => {
          const rowSet: Record<string, FileRow> = {};
          results.data.forEach((row, index) => {
            rowSet[String(index)] = row;
          });
          resolve(rowSet);
        },
        error: reject
      });
    });
  }

  async function stageRevisionFiles(): Promise<FileCollectionRowSet> {
    const staged: FileCollectionRowSet = {};
    for (const file of fileManagement.files) {
      staged[file.name] = await parseRevisionFile(file, selectedDelimiters[file.name]);
    }
    return staged;
  }
```

If revision mode must continue supporting `.xlsx` inputs, branch inside `parseRevisionFile()` to a spreadsheet parser there rather than assuming `UploadParseFiles` already staged those rows.

**Modify `handleInitialSubmit`** to branch on revision mode (around line 153):

```typescript
  async function handleInitialSubmit() {
    if (
      uploadState.state.uploadMode === UploadMode.REVISIONS &&
      uploadState.state.uploadForm === FormType.measurements
    ) {
      const stagedData = await stageRevisionFiles();
      setParsedData(stagedData);
      setRevisionMatchResult(null);
      uploadState.setReviewState(ReviewStates.REVISION_MATCH);
    } else {
      uploadState.setReviewState(ReviewStates.UPLOAD_SQL);
    }
  }
```

**Add revision match handler** (new function):

```typescript
  async function handleRevisionMatch() {
    if (Object.keys(parsedData).length === 0) {
      throw new Error('Revision files were not parsed before matching');
    }

    // Collect all parsed rows from all files into a flat array
    const allRows: FileRow[] = [];
    for (const fileName of Object.keys(parsedData)) {
      const fileRowSet = parsedData[fileName];
      for (const rowKey of Object.keys(fileRowSet)) {
        allRows.push(fileRowSet[rowKey]);
      }
    }

    try {
      const response = await fetch('/api/revisionupload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: allRows,
          plotID: currentPlotID,
          censusID: currentCensusID,
          schema: currentSite?.schemaName
        })
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(errorBody.error || 'Failed to classify revision rows');
      }

      const result = await response.json();
      setRevisionMatchResult(result);
    } catch (err: any) {
      errorHandling.setError(err);
      uploadState.setReviewState(ReviewStates.ERRORS);
    }
  }
```

Where `currentPlotID` and `currentCensusID` are derived from context (add near line 68 if not already present):

```typescript
  const currentPlotID = _currentPlot?.plotID ?? null;
  const currentCensusID = _currentCensus?.dateRanges?.[0]?.censusID ?? null;
```

**Add cases to `renderStateContent` switch** (after the UPLOAD_SQL case around line 240):

```typescript
      case ReviewStates.REVISION_MATCH:
        return (
          <UploadRevisionMatch
            matchedRows={revisionMatchResult?.matchedRows ?? []}
            newRows={revisionMatchResult?.newRows ?? []}
            invalidRows={revisionMatchResult?.invalidRows ?? []}
            counts={revisionMatchResult?.counts ?? { matched: 0, matchedWithChanges: 0, new: 0, invalid: 0, total: 0 }}
            schema={currentSite?.schemaName || ''}
            plotID={currentPlotID ?? 0}
            censusID={currentCensusID ?? 0}
            setReviewState={uploadState.setReviewState}
            onApply={(confirmNew) => {
              setRevisionConfirmNewRows(confirmNew);
              uploadState.setReviewState(ReviewStates.REVISION_APPLY);
            }}
            handleReturnToStart={handleReturnToStart}
          />
        );
      case ReviewStates.REVISION_APPLY:
        return (
          <UploadRevisionApply
            matchedRows={(revisionMatchResult?.matchedRows ?? []).filter(
              (r: any) => Object.keys(r.changes).length > 0
            ).map((r: any) => ({
              coreMeasurementID: r.coreMeasurementID,
              csvRow: r.csvRow
            }))}
            newRows={(revisionMatchResult?.newRows ?? []).map((r: any) => r.csvRow)}
            confirmNewRows={revisionConfirmNewRows}
            schema={currentSite?.schemaName || ''}
            setReviewState={uploadState.setReviewState}
            setIsDataUnsaved={uploadState.setIsDataUnsaved}
          />
        );
```

**Trigger match API call on REVISION_MATCH entry** — add a useEffect:

```typescript
  useEffect(() => {
    if (
      uploadState.state.reviewState === ReviewStates.REVISION_MATCH &&
      !revisionMatchResult &&
      Object.keys(parsedData).length > 0
    ) {
      handleRevisionMatch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedData, revisionMatchResult, uploadState.state.reviewState]);
```

- [ ] **Step 3: Verify the build compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Test the full flow in the dev server**

Run: `cd frontend && npm run dev`

1. Navigate to measurement upload
2. Select REVISIONS mode
3. Upload a CSV with `measurementID` column
4. Verify the review screen shows matched/new/invalid rows
5. Click Apply
6. Verify updates are applied and validation runs

- [ ] **Step 5: Commit**

```bash
git add frontend/components/uploadsystem/segments/uploadrevisionapply.tsx frontend/components/uploadsystem/uploadparent.tsx
git commit -m "Wire revision upload flow into upload parent with review and apply UI"
```

---

### Task 6: Revision upload integration tests

**Goal:** Write integration tests that verify the revision match and apply APIs against a local MySQL database.

**Files:**
- Create: `frontend/tests/integration/revision-upload.integration.test.ts`

**Acceptance Criteria:**
- [ ] Test matched row update with non-destructive merge semantics
- [ ] Test codes update rebuilds cmattributes associations
- [ ] Test comments update writes both Description and RawComments
- [ ] Test duplicate measurementID in file is rejected
- [ ] Test measurementID pointing to failed row (StemGUID IS NULL) is classified as invalid
- [ ] Test measurementID from a different plot in the same census is classified as invalid
- [ ] Test measurementID not found in census is classified as invalid
- [ ] Test blank measurementID + full payload is classified as new candidate
- [ ] Test blank measurementID + sparse fields is classified as invalid (incomplete)
- [ ] Test IsValidated reset to NULL after update
- [ ] Test original UploadFileID/UploadBatchID preserved after update
- [ ] Test only validation-sourced measurement_error_log rows are cleared on update
- [ ] Test apply rejects when an active validation run exists for the same plot/census
- [ ] Test apply rejects when an active upload session exists for the same plot/census
- [ ] Test unique constraint violation is surfaced as apply error

**Verify:** `cd frontend && npm run test:integration`

**Steps:**

- [ ] **Step 1: Create the test file with setup/teardown helpers**

Create `frontend/tests/integration/revision-upload.integration.test.ts`. This test uses the existing integration test infrastructure from `frontend/tests/setup/local-db-setup.ts`.

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
// Import test setup utilities from existing integration test infrastructure
import {
  createTestDatabase,
  dropTestDatabase,
  getTestConnection,
  loadSchema,
  loadStoredProcedures
} from '../setup/local-db-setup';

const TEST_SCHEMA = 'forestgeo_test_revision';

describe('Revision Upload API', () => {
  let connection: any;

  beforeAll(async () => {
    await createTestDatabase(TEST_SCHEMA);
    connection = await getTestConnection(TEST_SCHEMA);
    await loadSchema(connection, TEST_SCHEMA);
    await loadStoredProcedures(connection, TEST_SCHEMA);
  });

  afterAll(async () => {
    await dropTestDatabase(TEST_SCHEMA);
  });

  // Seed helper: insert a resolved measurement row and return its CoreMeasurementID
  async function seedMeasurement(overrides: Record<string, any> = {}) {
    // Insert prerequisite data (census, plot, quadrat, tree, stem) if not already present
    // Then insert a coremeasurements row
    // Return the CoreMeasurementID
    // ...implementation depends on existing seed helpers
  }

  // ... test cases follow
});
```

The exact seeding approach should use the existing helper functions from `local-db-setup.ts` (e.g., `seedCensus`, `seedPlot`, `seedQuadrat`, `seedTree`, `seedStem`). Check what helpers exist and use them. If they don't exist for the specific tables needed, create minimal INSERT statements.

- [ ] **Step 2: Write match/classify tests**

Key test cases for the match API:

```typescript
  describe('POST /api/revisionupload (match/classify)', () => {
    it('classifies rows with valid measurementID as matched revisions', async () => {
      const cmID = await seedMeasurement({ dbh: 10.5, hom: 1.3 });
      const rows = [{ measurementID: String(cmID), dbh: '12.0' }];
      // Call the match logic directly or via HTTP
      // Assert: matchedRows contains the row, changes shows dbh: {from: 10.5, to: '12.0'}
    });

    it('classifies measurementID pointing to StemGUID=NULL as invalid', async () => {
      const cmID = await seedFailedMeasurement(); // StemGUID IS NULL
      const rows = [{ measurementID: String(cmID), dbh: '12.0' }];
      // Assert: invalidRows contains the row with reason about failed measurement
    });

    it('classifies measurementID from a different plot in the same census as invalid', async () => {
      const otherPlotMeasurementID = await seedMeasurementInOtherPlot();
      const rows = [{ measurementID: String(otherPlotMeasurementID), dbh: '12.0' }];
      // Assert: invalidRows contains the row with reason about wrong plot scope
    });

    it('classifies measurementID not found in census as invalid', async () => {
      const rows = [{ measurementID: '999999', dbh: '12.0' }];
      // Assert: invalidRows contains the row with reason 'not found'
    });

    it('rejects file with duplicate measurementIDs', async () => {
      const cmID = await seedMeasurement();
      const rows = [
        { measurementID: String(cmID), dbh: '12.0' },
        { measurementID: String(cmID), dbh: '14.0' }
      ];
      // Assert: HTTP 400 with error about duplicates
    });

    it('classifies blank measurementID with full insert payload as new candidate', async () => {
      const rows = [{ tag: '100', spcode: 'QUER', quadrat: '0101', lx: '5.0', ly: '5.0', date: '2025-06-15' }];
      // Assert: newRows contains the row
    });

    it('classifies blank measurementID with missing required fields as invalid', async () => {
      const rows = [{ tag: '100', dbh: '10.0' }]; // missing spcode, quadrat, lx, ly, date
      // Assert: invalidRows with reason about missing fields
    });

    it('computes diff only for fields that actually changed', async () => {
      const cmID = await seedMeasurement({ dbh: 10.5, hom: 1.3, description: 'old comment' });
      const rows = [{ measurementID: String(cmID), dbh: '10.5', comments: 'new comment' }];
      // Assert: changes has 'comments' but not 'dbh' (same value)
    });
  });
```

- [ ] **Step 3: Write apply tests**

Key test cases for the apply API:

```typescript
  describe('POST /api/revisionupload/apply', () => {
    it('updates matched row with non-destructive merge', async () => {
      const cmID = await seedMeasurement({ dbh: 10.5, hom: 1.3, description: 'original' });
      // Apply with only dbh changed
      // Assert: MeasuredDBH updated, MeasuredHOM and Description unchanged
    });

    it('rebuilds cmattributes when codes are updated', async () => {
      const cmID = await seedMeasurement();
      // Seed initial cmattributes: ['A', 'B']
      // Apply with codes: 'C; D'
      // Assert: old cmattributes deleted, new ones ['C', 'D'] inserted
    });

    it('updates both Description and RawComments when comments changed', async () => {
      const cmID = await seedMeasurement({ description: 'old', rawComments: 'old' });
      // Apply with comments: 'new comment'
      // Assert: both Description and RawComments are 'new comment'
    });

    it('resets IsValidated to NULL on updated rows', async () => {
      const cmID = await seedMeasurement();
      // Set IsValidated = 1
      // Apply an update
      // Assert: IsValidated is NULL
    });

    it('preserves UploadFileID and UploadBatchID on updated rows', async () => {
      const cmID = await seedMeasurement({ uploadFileID: 'orig.csv', uploadBatchID: 'batch-001' });
      // Apply an update
      // Assert: UploadFileID and UploadBatchID unchanged
    });

    it('skips rows with no effective changes', async () => {
      const cmID = await seedMeasurement({ dbh: 10.5 });
      // Apply with dbh: '10.5' (same value)
      // Assert: skippedCount = 1, updatedCount = 0
    });

    it('surfaces unique constraint violation as apply error', async () => {
      // Seed two measurements with different dates
      // Try to update one to have the same date+dbh+hom as the other
      // Assert: applyErrors contains the constraint violation
    });

    it('clears only validation-owned measurement_error_log entries for updated rows', async () => {
      const cmID = await seedMeasurement();
      // Seed one validation error and one non-validation error in measurement_error_log
      // Apply an update
      // Assert: validation row deleted, non-validation row preserved
    });

    it('rejects apply when a validation run is already active for the same plot/census', async () => {
      // Seed a running validation_runs row for the current plot/census
      // Apply an update
      // Assert: HTTP 409 / conflict response
    });

    it('rejects apply when an upload session is already active for the same plot/census', async () => {
      // Seed an active upload_sessions row for the current plot/census
      // Apply an update
      // Assert: HTTP 409 / conflict response
    });
  });
```

- [ ] **Step 4: Run tests and verify**

Run: `cd frontend && npm run test:integration`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add frontend/tests/integration/revision-upload.integration.test.ts
git commit -m "Add integration tests for revision upload match and apply APIs"
```

---

## Task Dependencies

```
Task 0 (export) ──────────────┐
                               │
Task 1 (infrastructure) ──────┤
                               ├──> Task 4 (review UI) ──┐
Task 2 (match API) ───────────┤                          ├──> Task 5 (apply UI + wiring)
                               │                          │
Task 3 (apply API) ────────────┼──────────────────────────┘
                               │
                               └──> Task 6 (integration tests)
```

Tasks 0, 1, and 2 can be worked on in parallel. Task 3 depends on Task 2's response types. Tasks 4 and 5 depend on infrastructure + APIs. Task 6 depends on API routes being implemented.
