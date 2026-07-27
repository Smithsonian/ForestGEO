import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import { requireSession, getSessionUserId, getSessionUserIds } from '@/lib/auth-helpers';
import { HTTPResponses } from '@/config/macros';
import { FormType, SourceFormat } from '@/config/macros/formdetails';
import { UploadMode, normalizeUploadMode } from '@/config/uploadmodes';
import { isValidSchema } from '@/config/utils/sqlsecurity';
import ConnectionManager from '@/config/connectionmanager';
import { assertCanEditMeasurementScope, ScopeAccessError } from '@/config/editplan/scopeguard';
import { getPoolMonitorInstance } from '@/config/poolmonitorsingleton';
import { isColumnMappingShape } from '@/lib/column-mapping/mapping';
import { SUPPORTED_DELIMITERS } from '@/lib/uploads/detect-delimiter';
import { isAsyncUploadEnabledFor } from '@/lib/background-jobs/feature-gate';
import { isAllowedAsyncPipeline } from '@/lib/background-jobs/types';
import { createUploadBackgroundJob, listBackgroundJobs } from '@/lib/background-jobs/repository';
import { isPrivilegedSession, parseOptionalPositiveInteger } from '@/lib/background-jobs/route-helpers';
import { runJobIfClaimable } from '@/lib/background-jobs/worker';
import ailogger from '@/ailogger';

export const runtime = 'nodejs';

const ASYNC_UPLOADS_DISABLED_MESSAGE = 'Async uploads are not enabled for this form/site/user';

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
  byteSize: z.number().int().nonnegative().nullable().optional(),
  checksumSha256: z
    .string()
    .trim()
    .regex(/^[a-fA-F0-9]{64}$/)
    .nullable()
    .optional(),
  sourceFormat: z.enum(SourceFormat).nullable().optional(),
  formType: z.enum(FormType).nullable().optional(),
  expectedRows: z.number().int().nonnegative().nullable().optional()
});

const ArcgisImportSessionSchema = z.object({
  importSessionId: z.string().trim().min(1),
  fileName: z.string().trim().min(1),
  rowCount: z.number().int().nonnegative()
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
    idempotencyKey: z.string().trim().max(255).nullable().optional(),
    payload: UploadJobPayloadSchema.optional(),
    files: z.array(UploadJobFileSchema).min(1)
  })
  .superRefine((input, ctx) => {
    if (input.sourceFormat !== SourceFormat.arcgis_xlsx) return;
    const arcgisSession = ArcgisImportSessionSchema.safeParse(input.payload?.arcgisImportSession);
    if (!arcgisSession.success) {
      ctx.addIssue({
        code: 'custom',
        path: ['payload', 'arcgisImportSession'],
        message: 'ArcGIS uploads require payload.arcgisImportSession with importSessionId, fileName, and rowCount'
      });
    }
  });

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

export async function POST(request: NextRequest) {
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

  try {
    await assertCanEditMeasurementScope(ConnectionManager.getInstance(), session!, {
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

  const catalogPool = getPoolMonitorInstance().pool;
  const job = await createUploadBackgroundJob(
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

  // Kick-on-create: start the worker without awaiting it. runJobIfClaimable is
  // designed to never throw for job-level failures, but a claim-time
  // infrastructure error would otherwise surface as an unhandled rejection.
  void runJobIfClaimable(job.jobID).catch(error => {
    ailogger.error(`[UploadJobs API] Failed to start worker for job ${job.jobID}:`, error instanceof Error ? error : new Error(String(error)));
  });

  return NextResponse.json({ job, accepted: true }, { status: HTTPResponses.ACCEPTED });
}

export async function GET(request: NextRequest) {
  const session = await auth();
  const authError = requireSession(session);
  if (authError) return authError;

  const userID = getSessionUserId(session!);
  if (!userID) {
    return NextResponse.json({ error: 'Authenticated session has no user identifier' }, { status: HTTPResponses.UNAUTHORIZED });
  }

  const { searchParams } = new URL(request.url);
  const schema = searchParams.get('schema') || undefined;
  if (schema && !isValidSchema(schema)) {
    return NextResponse.json({ error: 'Invalid schema' }, { status: HTTPResponses.INVALID_REQUEST });
  }

  const plotID = parseOptionalPositiveInteger(searchParams.get('plotID'));
  const censusID = parseOptionalPositiveInteger(searchParams.get('censusID'));
  const activeOnly = searchParams.get('activeOnly') !== 'false';
  const includeAllUsers = searchParams.get('allUsers') === 'true' && isPrivilegedSession(session!);
  const limit = parseOptionalPositiveInteger(searchParams.get('limit'));

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
