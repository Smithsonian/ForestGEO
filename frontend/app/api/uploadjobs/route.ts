import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import { requireSession, getSessionUserId, getSessionUserIds } from '@/lib/auth-helpers';
import { HTTPResponses } from '@/config/macros';
import { FormType, SourceFormat } from '@/config/macros/formdetails';
import { UploadMode, normalizeUploadMode } from '@/config/uploadmodes';
import { isValidSchema } from '@/lib/db/sqlsecurity';
import ConnectionManager from '@/lib/db/connectionmanager';
import { assertCanEditMeasurementScope, ScopeAccessError } from '@/config/editplan/scopeguard';
import { getPoolMonitorInstance } from '@/lib/db/poolmonitorsingleton';
import { isColumnMappingShape } from '@/lib/column-mapping/mapping';
import { SUPPORTED_DELIMITERS } from '@/lib/uploads/detect-delimiter';
import { isAsyncUploadEnabledFor } from '@/lib/background-jobs/feature-gate';
import { isAllowedAsyncPipeline } from '@/lib/background-jobs/types';
import { createUploadBackgroundJob, listBackgroundJobs } from '@/lib/background-jobs/repository';
import { IdempotencyKeyConflictError } from '@/lib/background-jobs/errors';
import { isPrivilegedSession, MAX_UPLOAD_JOB_REQUEST_BYTES, parseOptionalPositiveInteger } from '@/lib/background-jobs/route-helpers';
import { runJobIfClaimable } from '@/lib/background-jobs/worker';
import { fromBody, fromQuery, withRouteAuthz, type RouteContext } from '@/lib/route-authz';
import { sanitizeUploadFileName } from '@/lib/uploads/file-names';
import { getContainerName, SchemaContainerNameError } from '@/config/macros/containernames';
import ailogger from '@/ailogger';

export const runtime = 'nodejs';

const ASYNC_UPLOADS_DISABLED_MESSAGE = 'Async uploads are not enabled for this form/site/user';
const MAX_UPLOAD_JOB_FILES = 100;
const MAX_UPLOAD_JOB_PAYLOAD_BYTES = 1024 * 1024;
const MAX_UPLOAD_FILE_BYTES = 100 * 1024 * 1024;
const MYSQL_SIGNED_INT_MAX = 2_147_483_647;

const SUPPORTED_DELIMITER_SET = new Set<string>(SUPPORTED_DELIMITERS);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateColumnMappings(value: unknown, ctx: z.RefinementCtx): void {
  if (value === undefined || value === null) return;
  if (!isPlainRecord(value)) {
    ctx.addIssue({ code: 'custom', path: ['columnMappings'], message: 'columnMappings must be an object keyed by file name' });
    return;
  }
  for (const [fileName, mapping] of Object.entries(value)) {
    if (!isColumnMappingShape(mapping)) {
      ctx.addIssue({ code: 'custom', path: ['columnMappings', fileName], message: `Column mapping for "${fileName}" is not a valid ColumnMapping` });
    }
  }
}

function validateSelectedDelimiters(value: unknown, ctx: z.RefinementCtx): void {
  if (value === undefined || value === null) return;
  if (!isPlainRecord(value)) {
    ctx.addIssue({ code: 'custom', path: ['selectedDelimiters'], message: 'selectedDelimiters must be an object keyed by file name' });
    return;
  }
  for (const [fileName, delimiter] of Object.entries(value)) {
    if (typeof delimiter !== 'string' || !SUPPORTED_DELIMITER_SET.has(delimiter)) {
      ctx.addIssue({
        code: 'custom',
        path: ['selectedDelimiters', fileName],
        message: `Delimiter for "${fileName}" must be one of the supported delimiters`
      });
    }
  }
}

const UploadJobFileSchema = z.object({
  fileName: z.string().trim().min(1).max(512),
  blobContainer: z.string().trim().min(1).max(255),
  blobName: z.string().trim().min(1).max(1024),
  contentType: z.string().trim().max(255).nullable().optional(),
  byteSize: z.number().int().nonnegative().max(MAX_UPLOAD_FILE_BYTES).nullable().optional(),
  checksumSha256: z
    .string()
    .trim()
    .regex(/^[a-fA-F0-9]{64}$/)
    .nullable()
    .optional(),
  sourceFormat: z.enum(SourceFormat).nullable().optional(),
  formType: z.enum(FormType).nullable().optional(),
  expectedRows: z.number().int().nonnegative().max(MYSQL_SIGNED_INT_MAX).nullable().optional()
});

const ArcgisImportSessionSchema = z.object({
  importSessionId: z.string().trim().min(1).max(255),
  fileName: z.string().trim().min(1).max(512),
  rowCount: z.number().int().nonnegative().max(MYSQL_SIGNED_INT_MAX)
});

const UploadJobPayloadSchema = z.record(z.string(), z.unknown()).superRefine((payload, ctx) => {
  validateColumnMappings(payload.columnMappings, ctx);
  validateSelectedDelimiters(payload.selectedDelimiters, ctx);
});

const CreateUploadJobSchema = z
  .object({
    schema: z.string().trim().min(1),
    plotID: z.number().int().positive(),
    censusID: z.number().int().positive(),
    uploadMode: z
      .string()
      .trim()
      .max(32)
      // normalizeUploadMode coerces anything unrecognized to CLEAN_REUPLOAD, so
      // a round-trip mismatch means the value is not a real UploadMode.
      .refine(value => normalizeUploadMode(value) === value, {
        message: `uploadMode must be one of: ${Object.values(UploadMode).join(', ')}`
      })
      .nullable()
      .optional(),
    sourceFormat: z.enum(SourceFormat),
    formType: z.enum(FormType),
    idempotencyKey: z.string().trim().min(1).max(255).nullable().optional(),
    payload: UploadJobPayloadSchema.optional(),
    files: z.array(UploadJobFileSchema).min(1).max(MAX_UPLOAD_JOB_FILES)
  })
  .superRefine((input, ctx) => {
    // Two sets, two jobs: `fileNames` (lower-cased) enforces uniqueness, which
    // must stay case-insensitive because the job's file identity is the
    // sanitized name. `exactFileNames` is what payload keys are checked against,
    // because the worker's lookups are case-sensitive property access.
    const fileNames = new Set<string>();
    const exactFileNames = new Set<string>();
    const blobIdentities = new Set<string>();
    let expectedRowTotal = 0;
    for (const [index, file] of input.files.entries()) {
      const normalizedFileName = file.fileName.toLowerCase();
      if (fileNames.has(normalizedFileName)) {
        ctx.addIssue({ code: 'custom', path: ['files', index, 'fileName'], message: 'File names must be unique within an upload job' });
      }
      fileNames.add(normalizedFileName);
      exactFileNames.add(file.fileName);

      const blobIdentity = `${file.blobContainer.toLowerCase()}\n${file.blobName.toLowerCase()}`;
      if (blobIdentities.has(blobIdentity)) {
        ctx.addIssue({ code: 'custom', path: ['files', index, 'blobName'], message: 'Blob references must be unique within an upload job' });
      }
      blobIdentities.add(blobIdentity);

      if (file.formType !== undefined && file.formType !== null && file.formType !== input.formType) {
        ctx.addIssue({ code: 'custom', path: ['files', index, 'formType'], message: 'Per-file formType must match the job formType' });
      }
      if (file.sourceFormat !== undefined && file.sourceFormat !== null && file.sourceFormat !== input.sourceFormat) {
        ctx.addIssue({ code: 'custom', path: ['files', index, 'sourceFormat'], message: 'Per-file sourceFormat must match the job sourceFormat' });
      }
      expectedRowTotal += file.expectedRows ?? 0;
    }
    if (expectedRowTotal > MYSQL_SIGNED_INT_MAX) {
      ctx.addIssue({ code: 'custom', path: ['files'], message: 'Combined expectedRows exceeds the supported job total' });
    }

    // Second layer: bounds the payload the worker will persist and replay.
    // MAX_UPLOAD_JOB_REQUEST_BYTES is what keeps an oversized body from being
    // buffered in the first place.
    if (Buffer.byteLength(JSON.stringify(input.payload ?? {}), 'utf8') > MAX_UPLOAD_JOB_PAYLOAD_BYTES) {
      ctx.addIssue({ code: 'custom', path: ['payload'], message: 'Upload job payload exceeds the 1 MiB limit' });
    }

    // EXACT-case, deliberately stricter than the duplicate-name check above.
    // The worker looks these up as columnMappings[file.fileName] /
    // selectedDelimiters[file.fileName] — plain property access, case-sensitive.
    // A case-insensitive check here let a key differing only in case pass
    // validation and then miss every lookup, so the file processed with default
    // aliasing and auto delimiter detection instead of the mapping the caller
    // supplied, silently. The wizard always rekeys exactly; this only affects
    // direct API callers, who now get a 400 instead of wrong results.
    for (const payloadKey of ['columnMappings', 'selectedDelimiters'] as const) {
      const record = input.payload?.[payloadKey];
      if (!isPlainRecord(record)) continue;
      for (const fileName of Object.keys(record)) {
        if (exactFileNames.has(fileName)) continue;
        const caseInsensitiveMatch = fileNames.has(fileName.toLowerCase());
        ctx.addIssue({
          code: 'custom',
          path: ['payload', payloadKey, fileName],
          message: caseInsensitiveMatch
            ? `${payloadKey} key "${fileName}" differs in case from the file it refers to; keys must match files[].fileName exactly`
            : `${payloadKey} contains an unknown file name`
        });
      }
    }

    if (input.sourceFormat === SourceFormat.arcgis_xlsx) {
      const arcgisSession = ArcgisImportSessionSchema.safeParse(input.payload?.arcgisImportSession);
      if (!arcgisSession.success) {
        ctx.addIssue({
          code: 'custom',
          path: ['payload', 'arcgisImportSession'],
          message: 'ArcGIS uploads require payload.arcgisImportSession with importSessionId, fileName, and rowCount'
        });
        // The pre-flight session records the raw browser file name while
        // files[].fileName is the sanitized name the blob upload stored, so the
        // identity cross-check has to run on the canonical form of both.
      } else if (input.files.length !== 1 || input.files[0]?.fileName !== sanitizeUploadFileName(arcgisSession.data.fileName)) {
        ctx.addIssue({
          code: 'custom',
          path: ['files'],
          message: 'ArcGIS uploads require exactly one file matching payload.arcgisImportSession.fileName'
        });
      }
    }
  });

/**
 * Rejects an unmeasurable or oversized request before any code reads its body.
 * The authz wrapper resolves the schema with `fromBody`, which clones and fully
 * parses the request, so this has to run ahead of the wrapper — not inside the
 * handler it guards.
 *
 * Content-Length is MANDATORY here, not merely honoured when present. The old
 * check read the header, coerced it with `Number()`, and let anything that was
 * not a finite number over the limit through: a missing header became
 * `Number(null)` = 0 and a malformed one became NaN, both of which passed. A
 * `Transfer-Encoding: chunked` POST therefore skipped the bound entirely and the
 * full body was still buffered and parsed downstream.
 *
 * This is safe for the supported client path: the wizard POSTs a string body via
 * fetch, and a string body has a known length, so the browser sets
 * Content-Length and never chunks it. The route test pins that. If a deployed
 * proxy is ever found stripping the header, the fix is a single-read byte-capped
 * parser — NOT relaxing this back to "optional", which is the bypass.
 */
function unmeasurableOrOversizedRequestResponse(request: NextRequest): NextResponse | null {
  const rawLength = request.headers.get('content-length');
  if (rawLength === null) {
    return NextResponse.json({ error: 'Upload job requests must declare a Content-Length' }, { status: HTTPResponses.LENGTH_REQUIRED });
  }

  // Digits only, matched explicitly rather than via Number(): the coercions are
  // all traps here — Number('') and Number(' ') are both 0, Number('12.5') is a
  // finite non-integer, and Number('0x10') is 16.
  const trimmedLength = rawLength.trim();
  if (!/^\d+$/.test(trimmedLength)) {
    return NextResponse.json({ error: `Invalid Content-Length: "${rawLength}"` }, { status: HTTPResponses.LENGTH_REQUIRED });
  }
  const declaredLength = Number(trimmedLength);

  if (declaredLength > MAX_UPLOAD_JOB_REQUEST_BYTES) {
    return NextResponse.json(
      { error: `Upload job request exceeds the ${MAX_UPLOAD_JOB_REQUEST_BYTES}-byte limit` },
      { status: HTTPResponses.PAYLOAD_TOO_LARGE }
    );
  }

  return null;
}

function validationErrorResponse(error: z.ZodError) {
  return NextResponse.json(
    {
      error: 'Validation failed',
      errors: error.issues.map(issue => ({
        field: issue.path.join('.'),
        message: issue.message
      }))
    },
    { status: HTTPResponses.INVALID_REQUEST }
  );
}

async function postHandler(request: NextRequest) {
  const session = await auth();
  const authError = requireSession(session);
  if (authError) return authError;

  const userID = getSessionUserId(session!);
  if (!userID) {
    return NextResponse.json({ error: 'Authenticated session has no user identifier' }, { status: HTTPResponses.UNAUTHORIZED });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: HTTPResponses.INVALID_REQUEST });
  }

  const parsed = CreateUploadJobSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const input = parsed.data;
  if (!isValidSchema(input.schema)) {
    return NextResponse.json({ error: 'Invalid schema' }, { status: HTTPResponses.INVALID_REQUEST });
  }

  let authorizedScope: { plotCensusNumber: number | null };
  try {
    authorizedScope = await assertCanEditMeasurementScope(ConnectionManager.getInstance(), session!, {
      schema: input.schema,
      plotID: input.plotID,
      censusID: input.censusID
    });
  } catch (error) {
    if (error instanceof ScopeAccessError) {
      return NextResponse.json({ error: error.message }, { status: HTTPResponses.FORBIDDEN });
    }
    ailogger.error('[UploadJobs API] Scope check failed:', error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ error: 'Failed to authorize upload job scope' }, { status: HTTPResponses.SERVICE_UNAVAILABLE });
  }

  if (!isAsyncUploadEnabledFor({ schema: input.schema, formType: input.formType, userIds: getSessionUserIds(session!) })) {
    return NextResponse.json({ error: ASYNC_UPLOADS_DISABLED_MESSAGE }, { status: HTTPResponses.FORBIDDEN });
  }

  // ASYNC_UPLOAD_V1_PIPELINES guard: reject at creation time any combination
  // the worker's resolveJobPipeline would refuse anyway.
  if (!isAllowedAsyncPipeline(input.formType, input.sourceFormat)) {
    return NextResponse.json(
      {
        error:
          `Async uploads only support measurements data in csv or arcgis_xlsx format; ` +
          `received formType="${input.formType}" sourceFormat="${input.sourceFormat}"`
      },
      { status: HTTPResponses.FORBIDDEN }
    );
  }

  // Blob containers are named after the plot census number, so THIS route
  // cannot proceed without one. The scope guard deliberately does not reject
  // such a census — routes that only need "does this scope exist and is it
  // mine" (edits, revisions, upload sessions) must keep working for censuses
  // whose nullable PlotCensusNumber was never populated.
  if (authorizedScope.plotCensusNumber === null) {
    return NextResponse.json(
      { error: `Census ${input.censusID} has no plot census number; async uploads need one to address blob storage` },
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }

  let authorizedContainer: string;
  try {
    authorizedContainer = getContainerName(input.schema, input.plotID, authorizedScope.plotCensusNumber);
  } catch (error) {
    if (error instanceof SchemaContainerNameError) {
      return NextResponse.json({ error: error.message }, { status: HTTPResponses.INVALID_REQUEST });
    }
    throw error;
  }
  if (input.files.some(file => file.blobContainer.toLowerCase() !== authorizedContainer.toLowerCase())) {
    return NextResponse.json({ error: 'Blob container does not match the authorized upload scope' }, { status: HTTPResponses.FORBIDDEN });
  }

  const catalogPool = getPoolMonitorInstance().pool;
  let job;
  try {
    job = await createUploadBackgroundJob(
      catalogPool,
      {
        schema: input.schema,
        plotID: input.plotID,
        censusID: input.censusID,
        uploadMode: input.uploadMode ?? null,
        sourceFormat: input.sourceFormat,
        formType: input.formType,
        idempotencyKey: input.idempotencyKey ?? null,
        payload: input.payload,
        files: input.files
      },
      userID
    );
  } catch (error) {
    if (error instanceof IdempotencyKeyConflictError) {
      return NextResponse.json({ error: error.message }, { status: HTTPResponses.CONFLICT });
    }
    throw error;
  }

  // Kick-on-create: start the worker without awaiting it. runJobIfClaimable is
  // designed to never throw for job-level failures, but a claim-time
  // infrastructure error would otherwise surface as an unhandled rejection.
  void runJobIfClaimable(job.jobID).catch(error => {
    ailogger.error(`[UploadJobs API] Failed to start worker for job ${job.jobID}:`, error instanceof Error ? error : new Error(String(error)));
  });

  return NextResponse.json({ job, accepted: true }, { status: HTTPResponses.ACCEPTED });
}

async function getHandler(request: NextRequest) {
  const session = await auth();
  const authError = requireSession(session);
  if (authError) return authError;

  const userID = getSessionUserId(session!);
  if (!userID) {
    return NextResponse.json({ error: 'Authenticated session has no user identifier' }, { status: HTTPResponses.UNAUTHORIZED });
  }

  const { searchParams } = new URL(request.url);
  const schema = searchParams.get('schema');
  if (!schema || !isValidSchema(schema)) {
    return NextResponse.json({ error: 'Invalid schema' }, { status: HTTPResponses.INVALID_REQUEST });
  }

  const rawPlotID = searchParams.get('plotID');
  const rawCensusID = searchParams.get('censusID');
  const rawLimit = searchParams.get('limit');
  const plotID = parseOptionalPositiveInteger(rawPlotID);
  const censusID = parseOptionalPositiveInteger(rawCensusID);
  const limit = parseOptionalPositiveInteger(rawLimit);
  if ((rawPlotID !== null && plotID === undefined) || (rawCensusID !== null && censusID === undefined) || (rawLimit !== null && limit === undefined)) {
    return NextResponse.json({ error: 'plotID, censusID, and limit must be positive integers when provided' }, { status: HTTPResponses.INVALID_REQUEST });
  }

  const rawActiveOnly = searchParams.get('activeOnly');
  const rawAllUsers = searchParams.get('allUsers');
  if (
    (rawActiveOnly !== null && rawActiveOnly !== 'true' && rawActiveOnly !== 'false') ||
    (rawAllUsers !== null && rawAllUsers !== 'true' && rawAllUsers !== 'false')
  ) {
    return NextResponse.json({ error: 'activeOnly and allUsers must be true or false when provided' }, { status: HTTPResponses.INVALID_REQUEST });
  }
  const activeOnly = rawActiveOnly !== 'false';
  const includeAllUsers = rawAllUsers === 'true' && isPrivilegedSession(session!);

  const jobs = await listBackgroundJobs(getPoolMonitorInstance().pool, {
    userID,
    includeAllUsers,
    activeOnly,
    schema,
    plotID,
    censusID,
    limit
  });

  return NextResponse.json({ jobs }, { status: HTTPResponses.OK });
}

const authorizedPost = withRouteAuthz('uploadjobs', postHandler, { schema: fromBody('schema') });

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  // Runs before authz on purpose: withRouteAuthz's fromBody('schema') clones and
  // parses the whole body to resolve the schema, which is exactly the work an
  // unbounded request must not be able to trigger.
  const rejected = unmeasurableOrOversizedRequestResponse(request);
  if (rejected) return rejected;
  return authorizedPost(request, context);
}

export const GET = withRouteAuthz('uploadjobs', getHandler, { schema: fromQuery('schema') });
