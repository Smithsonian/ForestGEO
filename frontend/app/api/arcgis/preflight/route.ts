import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import ailogger from '@/ailogger';
import ConnectionManager from '@/lib/db/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { assertCanEditMeasurementScope, ScopeAccessError } from '@/config/editplan/scopeguard';
import { isValidSchema } from '@/lib/db/sqlsecurity';
import { getSessionUserId, requireSession } from '@/lib/auth-helpers';
import { UnparseableDateError } from '@/lib/arcgis/errors';
import { readArcgisSheetMetadata, readArcgisWorkbookDetailed } from '@/lib/arcgis/workbook-reader';
import { transformArcgisWorkbook } from '@/lib/arcgis/transform';
import { createArcgisImportSession } from '@/lib/arcgis/import-session';
import { SourceFormat } from '@/config/macros/formdetails';
import { canonicalFieldsFor } from '@/lib/column-mapping/fields';
import { isColumnMappingShape, mappingMatchesSource, seedMapping, validateMapping } from '@/lib/column-mapping/mapping';
import { ArcgisMappingRequiredResponse, PREFLIGHT_STATUS_MAPPING_REQUIRED } from '@/lib/arcgis/types';
import type { ArcgisSourceMetadata, ColumnMapping } from '@/lib/column-mapping/types';

export const runtime = 'nodejs';

const MAX_ARCGIS_FILE_SIZE = 100 * 1024 * 1024;

const INVALID_MAPPING_PAYLOAD = 'Invalid mapping payload.';

function parsePositiveInteger(value: FormDataEntryValue | null): number | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function getStringField(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function workbookErrorResponse(error: Error): NextResponse | null {
  if (error instanceof UnparseableDateError) {
    return NextResponse.json({ error: error.message }, { status: HTTPResponses.INVALID_REQUEST });
  }
  return null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  const authError = requireSession(session);
  if (authError) return authError;

  const userId = getSessionUserId(session!);
  if (!userId) {
    return NextResponse.json({ error: 'Authenticated session has no user identifier' }, { status: HTTPResponses.UNAUTHORIZED });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Invalid ArcGIS pre-flight request: ${message}` }, { status: HTTPResponses.INVALID_REQUEST });
  }

  const schema = getStringField(formData, 'schema');
  const plotID = parsePositiveInteger(formData.get('plotID'));
  const censusID = parsePositiveInteger(formData.get('censusID'));
  const file = formData.get('file') as File | null;

  if (!schema || !plotID || !censusID || !file) {
    return NextResponse.json({ error: 'Missing required parameters: schema, plotID, censusID, and file' }, { status: HTTPResponses.INVALID_REQUEST });
  }
  if (!isValidSchema(schema)) {
    return NextResponse.json({ error: 'Invalid schema' }, { status: HTTPResponses.INVALID_REQUEST });
  }
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    return NextResponse.json({ error: 'ArcGIS import requires a single .xlsx workbook' }, { status: HTTPResponses.INVALID_REQUEST });
  }
  if (file.size > MAX_ARCGIS_FILE_SIZE) {
    return NextResponse.json(
      { error: `File too large. Maximum size is ${MAX_ARCGIS_FILE_SIZE / (1024 * 1024)}MB` },
      { status: HTTPResponses.PAYLOAD_TOO_LARGE }
    );
  }

  const mappingRaw = formData.get('mapping');
  let mapping: ColumnMapping | undefined;
  if (typeof mappingRaw === 'string' && mappingRaw.length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(mappingRaw);
    } catch {
      return NextResponse.json({ error: INVALID_MAPPING_PAYLOAD }, { status: HTTPResponses.INVALID_REQUEST });
    }
    if (!isColumnMappingShape(parsed)) {
      return NextResponse.json({ error: INVALID_MAPPING_PAYLOAD }, { status: HTTPResponses.INVALID_REQUEST });
    }
    mapping = parsed;
  }

  try {
    const connectionManager = ConnectionManager.getInstance();
    await assertCanEditMeasurementScope(connectionManager, session!, { schema, plotID, censusID });

    const buffer = await file.arrayBuffer();

    if (mapping) {
      // 400-class: wrong format or unknown canonical fields = broken/tampered client, not a remappable
      // workbook. The response body stays generic; the log records which check rejected.
      if (mapping.format !== SourceFormat.arcgis_xlsx) {
        ailogger.warn(`ArcGIS preflight rejected mapping: format mismatch (${mapping.format})`);
        return NextResponse.json({ error: INVALID_MAPPING_PAYLOAD }, { status: HTTPResponses.INVALID_REQUEST });
      }
      const known = new Set(canonicalFieldsFor(SourceFormat.arcgis_xlsx).map(d => d.canonicalField));
      const unknown = mapping.fields.map(f => f.canonicalField).filter(f => !known.has(f));
      if (unknown.length > 0) {
        ailogger.warn(`ArcGIS preflight rejected mapping: unknown canonical field(s): ${unknown.join(', ')}`);
        return NextResponse.json({ error: INVALID_MAPPING_PAYLOAD }, { status: HTTPResponses.INVALID_REQUEST });
      }

      const sheetInfo = await readArcgisSheetMetadata(buffer);
      const metadata: ArcgisSourceMetadata = {
        format: SourceFormat.arcgis_xlsx,
        sheets: sheetInfo,
        detectedTreesSheet: mapping.sheetRoles?.treesSheetName,
        detectedStemsSheet: mapping.sheetRoles?.stemsSheetName
      };

      // Staleness: only a PRESENT signature that no longer matches the workbook is stale. A signature-less
      // mapping is not auto-rejected here — validateMapping below is the gate for it.
      const stale = mapping.headerSignature !== undefined && !mappingMatchesSource(mapping, metadata);
      const validation = validateMapping(mapping, metadata);
      if (stale || !validation.valid) {
        const seeded = stale ? seedMapping(metadata) : mapping;
        return NextResponse.json(
          {
            status: PREFLIGHT_STATUS_MAPPING_REQUIRED,
            error: stale ? 'The saved column mapping does not match this workbook.' : 'The column mapping is incomplete.',
            format: SourceFormat.arcgis_xlsx,
            sheets: sheetInfo,
            mapping: seeded,
            validation: stale ? validateMapping(seeded, metadata) : validation
          } satisfies ArcgisMappingRequiredResponse,
          { status: HTTPResponses.OK }
        );
      }
    }

    const outcome = await readArcgisWorkbookDetailed(buffer, mapping);
    if (!outcome.ok) {
      const metadata: ArcgisSourceMetadata = {
        format: SourceFormat.arcgis_xlsx,
        sheets: outcome.sheets,
        detectedTreesSheet: mapping?.sheetRoles?.treesSheetName,
        detectedStemsSheet: mapping?.sheetRoles?.stemsSheetName
      };
      const seeded = mapping ?? seedMapping(metadata);
      const validation = validateMapping(seeded, metadata);
      return NextResponse.json(
        {
          status: PREFLIGHT_STATUS_MAPPING_REQUIRED,
          error: outcome.error.message,
          format: SourceFormat.arcgis_xlsx,
          sheets: outcome.sheets,
          mapping: seeded,
          validation
        } satisfies ArcgisMappingRequiredResponse,
        { status: HTTPResponses.OK }
      );
    }
    const workbook = outcome.workbook;

    const result = transformArcgisWorkbook(workbook);
    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'ArcGIS workbook did not produce any measurement rows' }, { status: HTTPResponses.UNPROCESSABLE_ENTITY });
    }

    const importReference = await createArcgisImportSession({
      schema,
      plotID,
      censusID,
      userId,
      fileName: file.name,
      result
    });

    return NextResponse.json(
      {
        ...importReference,
        summary: result.summary,
        warnings: result.warnings
      },
      { status: HTTPResponses.OK }
    );
  } catch (error: unknown) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    const workbookResponse = workbookErrorResponse(errorObj);
    if (workbookResponse) return workbookResponse;

    if (error instanceof ScopeAccessError) {
      return NextResponse.json({ error: error.message }, { status: HTTPResponses.FORBIDDEN });
    }

    ailogger.error('ArcGIS pre-flight failed:', errorObj);
    return NextResponse.json({ error: errorObj.message || 'ArcGIS pre-flight failed' }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  }
}
