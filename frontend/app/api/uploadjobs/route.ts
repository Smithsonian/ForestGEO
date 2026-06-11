import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import { requireSession, getSessionUserId } from '@/lib/auth-helpers';
import { HTTPResponses } from '@/config/macros';
import { isValidSchema } from '@/config/utils/sqlsecurity';
import ConnectionManager from '@/config/connectionmanager';
import { assertCanEditMeasurementScope, ScopeAccessError } from '@/config/editplan/scopeguard';
import { getPoolMonitorInstance } from '@/config/poolmonitorsingleton';
import { createUploadBackgroundJob, listBackgroundJobs } from '@/lib/background-jobs/repository';
import { isPrivilegedSession, parseOptionalPositiveInteger } from '@/lib/background-jobs/route-helpers';
import ailogger from '@/ailogger';

export const runtime = 'nodejs';

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
  sourceFormat: z.string().trim().max(32).nullable().optional(),
  formType: z.string().trim().max(32).nullable().optional(),
  expectedRows: z.number().int().nonnegative().nullable().optional()
});

const CreateUploadJobSchema = z.object({
  schema: z.string().trim().min(1),
  plotID: z.number().int().positive(),
  censusID: z.number().int().positive(),
  uploadMode: z.string().trim().max(32).nullable().optional(),
  sourceFormat: z.string().trim().max(32).nullable().optional(),
  formType: z.string().trim().max(32).nullable().optional(),
  idempotencyKey: z.string().trim().max(255).nullable().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  files: z.array(UploadJobFileSchema).min(1)
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

  const catalogPool = getPoolMonitorInstance().pool;
  const job = await createUploadBackgroundJob(
    catalogPool,
    {
      schema: input.schema,
      plotID: input.plotID,
      censusID: input.censusID,
      uploadMode: input.uploadMode ?? null,
      sourceFormat: input.sourceFormat ?? null,
      formType: input.formType ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      payload: input.payload,
      files: input.files
    },
    userID
  );

  return NextResponse.json({ job, enqueued: false }, { status: HTTPResponses.CREATED });
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
