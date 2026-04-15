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

type UpdatableField = (typeof UPDATABLE_FIELDS)[number];

/** Required fields for inserting a brand-new measurement row. */
const REQUIRED_INSERT_FIELDS = ['tag', 'spcode', 'quadrat', 'lx', 'ly', 'date'] as const;

/** Maps CSV field names to the corresponding DB column names in coremeasurements. */
const CSV_FIELD_TO_DB_COLUMN: Record<UpdatableField, string> = {
  dbh: 'MeasuredDBH',
  hom: 'MeasuredHOM',
  date: 'MeasurementDate',
  codes: 'RawCodes',
  comments: 'Description'
};

interface ExistingMeasurementRow {
  CoreMeasurementID: number;
  StemGUID: number | null;
  MeasuredDBH: number | null;
  MeasuredHOM: number | null;
  MeasurementDate: Date | string | null;
  RawCodes: string | null;
  Description: string | null;
}

interface MatchedRow {
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

interface NewRowCandidate {
  csvRow: FileRow;
  csvIndex: number;
}

interface InvalidRow {
  csvRow: FileRow;
  csvIndex: number;
  reason: string;
}

interface RevisionUploadRequest {
  rows: FileRow[];
  plotID: number;
  censusID: number;
  schema: string;
}

interface RevisionUploadResponse {
  matchedRows: MatchedRow[];
  newRows: NewRowCandidate[];
  invalidRows: InvalidRow[];
  counts: {
    matched: number;
    matchedWithChanges: number;
    new: number;
    invalid: number;
    total: number;
  };
}

function normalizeDateToString(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  // Already a string — extract just YYYY-MM-DD if it has a time component
  return String(value).slice(0, 10);
}

function computeDiff(csvRow: FileRow, dbRow: ExistingMeasurementRow): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  for (const field of UPDATABLE_FIELDS) {
    const csvValue = csvRow[field];
    if (csvValue === undefined || csvValue === null || String(csvValue).trim() === '') {
      continue;
    }

    const dbColumn = CSV_FIELD_TO_DB_COLUMN[field];
    let dbValue: unknown;

    if (field === 'date') {
      dbValue = normalizeDateToString(dbRow.MeasurementDate as Date | string | null);
    } else {
      dbValue = dbRow[dbColumn as keyof ExistingMeasurementRow];
      // Normalize numeric DB values to string for comparison against CSV strings
      if (dbValue !== null && dbValue !== undefined && typeof dbValue === 'number') {
        dbValue = String(dbValue);
      }
    }

    if (String(csvValue).trim() !== String(dbValue ?? '').trim()) {
      changes[field] = { from: dbValue, to: csvValue };
    }
  }

  return changes;
}

function detectDuplicateMeasurementIDs(rows: FileRow[]): string[] {
  const idCounts = new Map<string, number>();
  for (const row of rows) {
    const id = row['measurementID'];
    if (id !== null && id !== undefined && String(id).trim() !== '') {
      const normalized = String(id).trim();
      idCounts.set(normalized, (idCounts.get(normalized) ?? 0) + 1);
    }
  }

  return Array.from(idCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([id]) => id);
}

async function lookupMeasurementInActiveCensus(
  connectionManager: ConnectionManager,
  schema: string,
  coreMeasurementID: number,
  censusID: number,
  plotID: number
): Promise<ExistingMeasurementRow | null> {
  const query = safeFormatQuery(
    schema,
    `SELECT cm.CoreMeasurementID, cm.StemGUID, cm.MeasuredDBH, cm.MeasuredHOM,
            cm.MeasurementDate, cm.RawCodes, cm.Description
     FROM ??.coremeasurements cm
     JOIN ??.stems st ON st.StemGUID = cm.StemGUID AND st.IsActive = 1
     JOIN ??.quadrats q ON q.QuadratID = st.QuadratID AND q.IsActive = 1
     WHERE cm.CoreMeasurementID = ?
       AND cm.CensusID = ?
       AND cm.IsActive = 1
       AND q.PlotID = ?`
  );

  const rows = await connectionManager.executeQuery(query, [coreMeasurementID, censusID, plotID]);
  return rows.length > 0 ? (rows[0] as ExistingMeasurementRow) : null;
}

async function measurementExistsInCensusForAnyPlot(
  connectionManager: ConnectionManager,
  schema: string,
  coreMeasurementID: number,
  censusID: number
): Promise<boolean> {
  const query = safeFormatQuery(
    schema,
    `SELECT 1
     FROM ??.coremeasurements cm
     WHERE cm.CoreMeasurementID = ?
       AND cm.CensusID = ?
       AND cm.IsActive = 1
     LIMIT 1`
  );

  const rows = await connectionManager.executeQuery(query, [coreMeasurementID, censusID]);
  return rows.length > 0;
}

async function measurementExistsWithNullStem(
  connectionManager: ConnectionManager,
  schema: string,
  coreMeasurementID: number,
  censusID: number
): Promise<boolean> {
  const query = safeFormatQuery(
    schema,
    `SELECT 1
     FROM ??.coremeasurements cm
     WHERE cm.CoreMeasurementID = ?
       AND cm.CensusID = ?
       AND cm.StemGUID IS NULL
     LIMIT 1`
  );

  const rows = await connectionManager.executeQuery(query, [coreMeasurementID, censusID]);
  return rows.length > 0;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: HTTPResponses.UNAUTHORIZED });
  }

  let body: RevisionUploadRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: HTTPResponses.INVALID_REQUEST });
  }

  const { rows, plotID, censusID, schema } = body;

  if (!rows || !Array.isArray(rows) || plotID === undefined || censusID === undefined || !schema) {
    return NextResponse.json(
      { error: 'Missing required parameters: rows (array), plotID, censusID, schema' },
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }

  if (!isValidSchema(schema)) {
    return NextResponse.json({ error: 'Invalid schema' }, { status: HTTPResponses.INVALID_REQUEST });
  }

  const duplicateIDs = detectDuplicateMeasurementIDs(rows);
  if (duplicateIDs.length > 0) {
    return NextResponse.json(
      {
        error: 'Duplicate measurementIDs found in file — entire file rejected',
        duplicateIDs
      },
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }

  const connectionManager = ConnectionManager.getInstance();
  const matchedRows: MatchedRow[] = [];
  const newRows: NewRowCandidate[] = [];
  const invalidRows: InvalidRow[] = [];

  try {
    for (let csvIndex = 0; csvIndex < rows.length; csvIndex++) {
      const csvRow = rows[csvIndex];
      const rawMeasurementID = csvRow['measurementID'];
      const hasMeasurementID = rawMeasurementID !== null && rawMeasurementID !== undefined && String(rawMeasurementID).trim() !== '';

      if (hasMeasurementID) {
        const parsedID = parseInt(String(rawMeasurementID).trim(), 10);
        if (isNaN(parsedID)) {
          invalidRows.push({ csvRow, csvIndex, reason: `measurementID "${rawMeasurementID}" is not a valid integer` });
          continue;
        }

        const matchedInPlot = await lookupMeasurementInActiveCensus(connectionManager, schema, parsedID, censusID, plotID);

        if (matchedInPlot !== null) {
          if (matchedInPlot.StemGUID === null) {
            invalidRows.push({ csvRow, csvIndex, reason: 'measurementID refers to a failed measurement (StemGUID is null)' });
            continue;
          }

          const changes = computeDiff(csvRow, matchedInPlot);
          matchedRows.push({
            csvRow,
            coreMeasurementID: matchedInPlot.CoreMeasurementID,
            existingValues: {
              measuredDBH: matchedInPlot.MeasuredDBH,
              measuredHOM: matchedInPlot.MeasuredHOM,
              measurementDate: normalizeDateToString(matchedInPlot.MeasurementDate as Date | string | null),
              rawCodes: matchedInPlot.RawCodes,
              description: matchedInPlot.Description
            },
            changes
          });
          continue;
        }

        // Not found in the active census + plot — disambiguate the reason
        const existsInCensusForAnyPlot = await measurementExistsInCensusForAnyPlot(connectionManager, schema, parsedID, censusID);
        if (existsInCensusForAnyPlot) {
          invalidRows.push({ csvRow, csvIndex, reason: 'measurementID exists in this census but belongs to a different plot' });
          continue;
        }

        const isFailedMeasurement = await measurementExistsWithNullStem(connectionManager, schema, parsedID, censusID);
        if (isFailedMeasurement) {
          invalidRows.push({ csvRow, csvIndex, reason: 'measurementID refers to a failed measurement (StemGUID is null)' });
          continue;
        }

        invalidRows.push({ csvRow, csvIndex, reason: 'measurementID not found in the active census' });
      } else {
        const missingFields = REQUIRED_INSERT_FIELDS.filter(field => {
          const value = csvRow[field];
          return value === null || value === undefined || String(value).trim() === '';
        });

        if (missingFields.length === 0) {
          newRows.push({ csvRow, csvIndex });
        } else {
          invalidRows.push({
            csvRow,
            csvIndex,
            reason: `missing required fields for new row: ${missingFields.join(', ')}`
          });
        }
      }
    }

    const response: RevisionUploadResponse = {
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
    };

    return NextResponse.json(response, { status: HTTPResponses.OK });
  } catch (error: unknown) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    ailogger.error('[revisionupload API] Error classifying rows:', errorObj);
    return NextResponse.json({ error: errorObj.message }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    await connectionManager.closeConnection();
  }
}
