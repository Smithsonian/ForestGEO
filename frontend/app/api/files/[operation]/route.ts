import { NextRequest, NextResponse } from 'next/server';
import { getContainerClient, uploadValidFileAsBufferWithMetadata, type FileRowErrors } from '@/config/macros/azurestorage';
import { BlobSASPermissions, BlobServiceClient, generateBlobSASQueryParameters, StorageSharedKeyCredential } from '@azure/storage-blob';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';
import { getContainerName, SchemaContainerNameError } from '@/config/macros/containernames';
import { auth } from '@/auth';
import { getSessionUserId } from '@/lib/auth-helpers';
import { isValidSchema } from '@/lib/db/sqlsecurity';
import { fromQuery, withRouteAuthz, type RouteContext } from '@/lib/route-authz';
import {
  attemptScopedBlobName,
  isValidUploadAttemptID,
  measurementFileIDValidationError,
  sanitizeUploadFileName as sanitizeFileName
} from '@/lib/uploads/file-names';
import path from 'path';
import type { Session } from 'next-auth';
import { FormType, normalizeSourceFormat, SourceFormat } from '@/config/macros/formdetails';
import { z } from 'zod';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

// Security: Allowed file extensions and MIME types
const ALLOWED_FILE_EXTENSIONS = ['.csv', '.txt', '.xlsx'] as const;
const ALLOWED_MIME_TYPES = ['text/csv', 'text/plain', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] as const;
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB limit

function isValidFileExtension(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return ALLOWED_FILE_EXTENSIONS.includes(ext as any);
}

function isValidMimeType(mimeType: string): boolean {
  return ALLOWED_MIME_TYPES.includes(mimeType as any);
}

const READ_ONLY_CONTAINER_OPTIONS = { createIfMissing: false } as const;

/**
 * Mirrors FileRowErrors. These elements are written into blob metadata and read
 * back as trusted values, so the shape is checked rather than asserted.
 */
const FileRowErrorsArraySchema = z.array(
  z.object({
    stemtag: z.string(),
    tag: z.string(),
    validationErrorID: z.number().int()
  })
);

/** JSON.parse that reports failure as a value, so the caller does one check. */
function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

type FileOperation = 'upload' | 'download' | 'delete' | 'list';

const VALID_OPERATIONS: Record<string, FileOperation> = {
  upload: 'upload',
  download: 'download',
  delete: 'delete',
  list: 'list'
} as const;

interface FileOperationParams {
  schema?: string;
  container?: string;
  filename?: string;
  plotID?: string;
  census?: string;
  user?: string;
  formType?: string;
  sourceFormat?: string;
  /**
   * Identifies one upload attempt. When present, the blob is written under an
   * attempt-scoped path with create-only semantics instead of the
   * probe-then-suffix search, and the attempt is recorded in blob metadata so
   * job creation can require that the blob it is handed belongs to this
   * uploader and this attempt.
   */
  attemptID?: string;
}

interface AuthorizedFileScope {
  userId: string;
  container: string;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function hasSchemaAccess(session: Session, schema: string): boolean {
  const role = session.user?.userStatus;
  if (role === 'global' || role === 'db admin') return true;
  return (session.user?.sites ?? []).some(site => site.schemaName === schema);
}

function normalizeContainerName(containerName: string | undefined): string | undefined {
  return containerName?.trim().toLowerCase();
}

function requestedContainerMatchesScope(params: FileOperationParams, scope: Pick<AuthorizedFileScope, 'container'>): boolean {
  const requested = normalizeContainerName(params.container);
  // Callers no longer need to supply a container; when they do, it must match
  // the server-derived schema-scoped container exactly.
  return requested === undefined || requested === scope.container.toLowerCase();
}

function authorizeFileScope(session: Session, params: FileOperationParams): AuthorizedFileScope | NextResponse {
  const { schema } = params;
  if (!schema) {
    return new NextResponse(JSON.stringify({ error: 'Schema is required' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  if (!isValidSchema(schema)) {
    ailogger.warn(`Invalid schema provided for file operation: ${schema}`);
    return new NextResponse(JSON.stringify({ error: 'Invalid schema' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  if (!hasSchemaAccess(session, schema)) {
    return new NextResponse(JSON.stringify({ error: 'Forbidden - site access required' }), { status: HTTPResponses.FORBIDDEN });
  }

  const userId = getSessionUserId(session);
  if (!userId) {
    return new NextResponse(JSON.stringify({ error: 'Authenticated session has no user identifier' }), { status: HTTPResponses.UNAUTHORIZED });
  }

  const censusNumber = parsePositiveInteger(params.census);
  if (!censusNumber) {
    return new NextResponse(JSON.stringify({ error: 'Census parameter is required' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const plotID = parsePositiveInteger(params.plotID);
  if (!plotID) {
    return new NextResponse(JSON.stringify({ error: 'plotID parameter is required' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  // F19: the storage container is scoped by the (already authz-validated) schema
  // so sites that reuse a plotID/census cannot reach one another's files.
  let container: string;
  try {
    container = getContainerName(schema, plotID, censusNumber);
  } catch (error) {
    if (error instanceof SchemaContainerNameError) {
      return new NextResponse(JSON.stringify({ error: error.message }), { status: HTTPResponses.INVALID_REQUEST });
    }
    throw error;
  }

  const scope = { userId, container };

  if (!requestedContainerMatchesScope(params, scope)) {
    return new NextResponse(JSON.stringify({ error: 'Forbidden - container does not match authorized scope' }), { status: HTTPResponses.FORBIDDEN });
  }

  return scope;
}

/**
 * Unified file operations endpoint for Azure Storage
 * Handles upload, download, delete, and list operations
 */

// POST: Upload file
async function handleUpload(request: NextRequest, context: RouteContext) {
  // withRouteAuthz already authenticated the session and enforced per-site
  // access; re-read the session here for identity + container-scope resolution.
  const session = await auth();

  const operation = (await context.params).operation as string;

  if (operation !== 'upload') {
    return new NextResponse(JSON.stringify({ error: 'POST method only supports upload operation' }), { status: HTTPResponses.METHOD_NOT_ALLOWED });
  }

  const params = extractParams(request);
  // defense-in-depth behind guard: re-checks schema membership and validates the
  // requested container matches the server-derived plot/census scope.
  const scope = authorizeFileScope(session!, params);
  if (scope instanceof NextResponse) return scope;

  let formData: FormData;
  try {
    formData = await request.formData();
    if (formData === null || formData === undefined || formData.entries().next().done) {
      throw new Error('No form data provided');
    }
  } catch {
    return new NextResponse(JSON.stringify({ error: 'File is required' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const { fileName, formType, sourceFormat, attemptID } = params;
  const file = formData.get(fileName ?? 'file') as File | null;
  let fileRowErrors: FileRowErrors[] = [];
  const rawFileRowErrors = formData.get('fileRowErrors');
  if (rawFileRowErrors !== null) {
    // Element shape is VALIDATED, not asserted. The old `as FileRowErrors[]`
    // checked only that the JSON was an array, so arbitrary caller-controlled
    // objects were written straight into blob metadata under a type the rest of
    // the code trusts.
    const parsed = FileRowErrorsArraySchema.safeParse(safeJsonParse(String(rawFileRowErrors)));
    if (!parsed.success) {
      return new NextResponse(JSON.stringify({ error: 'fileRowErrors must be a JSON array of { tag, stemtag, validationErrorID } objects' }), {
        status: HTTPResponses.INVALID_REQUEST
      });
    }
    fileRowErrors = parsed.data;
  }

  // Validate required parameters for upload
  if (!file || !fileName || !formType) {
    return new NextResponse(JSON.stringify({ error: 'Missing required parameters: fileName, formType, and file' }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }

  const normalizedSourceFormat = normalizeSourceFormat(sourceFormat ?? SourceFormat.csv);
  if (!normalizedSourceFormat) {
    return new NextResponse(JSON.stringify({ error: 'Invalid sourceFormat' }), { status: HTTPResponses.INVALID_REQUEST });
  }
  if (normalizedSourceFormat === SourceFormat.arcgis_xlsx && formType !== FormType.measurements) {
    return new NextResponse(JSON.stringify({ error: 'ArcGIS .xlsx sourceFormat is only valid for measurements uploads' }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }
  if (normalizedSourceFormat === SourceFormat.arcgis_xlsx && !fileName.toLowerCase().endsWith('.xlsx')) {
    return new NextResponse(JSON.stringify({ error: 'ArcGIS uploads must use a .xlsx workbook' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  // Security validations
  // 1. File size check
  if (file.size > MAX_FILE_SIZE) {
    ailogger.warn(`File too large: ${file.size} bytes (max: ${MAX_FILE_SIZE})`);
    return new NextResponse(JSON.stringify({ error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB` }), {
      status: HTTPResponses.PAYLOAD_TOO_LARGE
    });
  }

  // 2. File extension validation
  if (!isValidFileExtension(fileName)) {
    ailogger.warn(`Invalid file extension: ${fileName}`);
    return new NextResponse(JSON.stringify({ error: 'Invalid file type. Only .csv, .txt, and .xlsx files are allowed' }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }

  // 3. MIME type validation
  if (!isValidMimeType(file.type)) {
    ailogger.warn(`Invalid MIME type: ${file.type} for file ${fileName}`);
    return new NextResponse(
      JSON.stringify({
        error: 'Invalid file type. Only CSV, TXT, and XLSX files are allowed',
        details: `Received MIME type: ${file.type}`
      }),
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }

  // 4. Sanitize filename to prevent path traversal
  const sanitizedFileName = sanitizeFileName(fileName);
  if (sanitizedFileName !== fileName) {
    ailogger.warn(`File name sanitized: ${fileName} -> ${sanitizedFileName}`);
  }

  if (formType === FormType.measurements) {
    const fileIDError = measurementFileIDValidationError(sanitizedFileName);
    if (fileIDError) {
      return NextResponse.json({ error: fileIDError, code: 'MEASUREMENT_FILE_NAME_TOO_LONG' }, { status: HTTPResponses.INVALID_REQUEST });
    }
  }

  if (attemptID !== undefined && !isValidUploadAttemptID(attemptID)) {
    return new NextResponse(JSON.stringify({ error: 'attemptID must be 8-64 characters of A-Z, a-z, 0-9, dash, or underscore' }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }
  // Attempt-scoped path: two attempts can never contend for one blob name, so
  // the exists()-then-write race disappears rather than being narrowed.
  const targetBlobName = attemptID ? attemptScopedBlobName(attemptID, sanitizedFileName) : sanitizedFileName;

  try {
    // getContainerClient now throws with detailed error messages on failure
    const containerClient = await getContainerClient(scope.container);

    // uploadValidFileAsBuffer now always returns a response or throws
    const uploadResult = await uploadValidFileAsBufferWithMetadata(
      containerClient,
      file,
      scope.userId,
      formType,
      fileRowErrors,
      targetBlobName,
      normalizedSourceFormat,
      attemptID ? { attemptID } : undefined
    );

    // Verify the response status
    if (uploadResult.response._response.status < 200 || uploadResult.response._response.status >= 300) {
      throw new Error(`Upload failed: Azure returned status ${uploadResult.response._response.status}`);
    }

    ailogger.info(`File uploaded successfully: ${uploadResult.blobName} by ${scope.userId}`);
    return new NextResponse(
      JSON.stringify({
        message: 'File uploaded successfully',
        fileName: sanitizedFileName,
        // Both names travel back: the canonical one is the job's file identity,
        // the original is what the user recognizes in an error message.
        originalFileName: fileName,
        blobContainer: scope.container,
        blobName: uploadResult.blobName,
        attemptID: attemptID ?? null,
        contentType: file.type || null,
        byteSize: file.size,
        formType,
        sourceFormat: normalizedSourceFormat
      }),
      { status: HTTPResponses.OK }
    );
  } catch (error: any) {
    // Log the full error for debugging but don't expose details to client
    ailogger.error(`File upload error for ${sanitizedFileName} (${scope.container}): ${error.message}`);
    return new NextResponse(
      JSON.stringify({
        error: 'Failed to upload file',
        // Include a sanitized hint for common issues
        hint: error.message?.includes('AZURE_STORAGE')
          ? 'Azure Storage configuration issue'
          : error.message?.includes('container')
            ? 'Storage container access issue'
            : 'Upload processing failed'
      }),
      { status: HTTPResponses.INTERNAL_SERVER_ERROR }
    );
  }
}

// GET: Download file or list files
async function handleGet(request: NextRequest, context: RouteContext) {
  // withRouteAuthz already authenticated the session and enforced per-site
  // access; re-read the session here for identity + container-scope resolution.
  const session = await auth();

  const operation = (await context.params).operation as string;

  if (!VALID_OPERATIONS[operation] || !['download', 'list'].includes(operation)) {
    return new NextResponse(JSON.stringify({ error: 'GET method supports download and list operations only' }), { status: HTTPResponses.METHOD_NOT_ALLOWED });
  }

  const params = extractParams(request);
  // defense-in-depth behind guard: re-checks schema membership and validates the
  // requested container matches the server-derived plot/census scope.
  const scope = authorizeFileScope(session!, params);
  if (scope instanceof NextResponse) return scope;

  if (operation === 'download') {
    return handleDownload(params, scope);
  } else if (operation === 'list') {
    return handleList(scope);
  }

  return new NextResponse(JSON.stringify({ error: 'Invalid operation' }), { status: HTTPResponses.INVALID_REQUEST });
}

// DELETE: Delete file
async function handleDeleteRequest(request: NextRequest, context: RouteContext) {
  // withRouteAuthz already authenticated the session and enforced per-site
  // access; re-read the session here for identity + container-scope resolution.
  const session = await auth();

  const operation = (await context.params).operation as string;

  if (operation !== 'delete') {
    return new NextResponse(JSON.stringify({ error: 'DELETE method only supports delete operation' }), { status: HTTPResponses.METHOD_NOT_ALLOWED });
  }

  const params = extractParams(request);
  // defense-in-depth behind guard: re-checks schema membership and validates the
  // requested container matches the server-derived plot/census scope.
  const scope = authorizeFileScope(session!, params);
  if (scope instanceof NextResponse) return scope;
  return handleDelete(params, scope);
}

export const POST = withRouteAuthz('files/[operation]', handleUpload, { schema: fromQuery('schema') });
export const GET = withRouteAuthz('files/[operation]', handleGet, { schema: fromQuery('schema') });
export const DELETE = withRouteAuthz('files/[operation]', handleDeleteRequest, { schema: fromQuery('schema') });

// Helper function to extract parameters from request
function extractParams(request: NextRequest): FileOperationParams & { fileName?: string } {
  const searchParams = request.nextUrl.searchParams;

  return {
    schema: searchParams.get('schema')?.trim() || undefined,
    container: searchParams.get('container')?.trim() || undefined,
    filename: searchParams.get('filename')?.trim() || undefined,
    fileName: searchParams.get('fileName')?.trim() || undefined,
    plotID: searchParams.get('plotID')?.trim() || undefined,
    census: searchParams.get('census')?.trim() || undefined,
    user: searchParams.get('user')?.trim() || undefined,
    formType: searchParams.get('formType')?.trim() || undefined,
    sourceFormat: searchParams.get('sourceFormat')?.trim() || undefined,
    attemptID: searchParams.get('attemptID')?.trim() || undefined
  };
}

// Handle file download with backward compatibility
async function handleDownload(params: FileOperationParams & { filename?: string }, scope: AuthorizedFileScope) {
  const { filename } = params;
  const storageAccountConnectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;

  if (!filename || !storageAccountConnectionString) {
    return new NextResponse(JSON.stringify({ error: 'Filename and storage connection string are required' }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }

  try {
    const blobServiceClient = BlobServiceClient.fromConnectionString(storageAccountConnectionString);

    // F19: only the schema-scoped container is consulted; legacy shared
    // containers are never read from a user-facing path.
    const containerClient = await getContainerClient(scope.container, READ_ONLY_CONTAINER_OPTIONS);
    if (!containerClient) {
      return new NextResponse(JSON.stringify({ error: 'Failed to get container client' }), {
        status: HTTPResponses.INVALID_REQUEST
      });
    }

    const exists = await containerClient.exists();
    if (!exists) {
      return new NextResponse(JSON.stringify({ error: `Container not found: ${scope.container}` }), {
        status: HTTPResponses.NOT_FOUND
      });
    }

    const blobClient = containerClient.getBlobClient(filename);

    // Generate SAS token for secure download
    const sasOptions = {
      containerName: scope.container,
      blobName: filename,
      startsOn: new Date(),
      expiresOn: new Date(new Date().valueOf() + 3600 * 1000), // 1 hour expiration
      permissions: BlobSASPermissions.parse('r') // read-only permission
    };

    let sasToken = '';
    if (blobServiceClient.credential instanceof StorageSharedKeyCredential) {
      sasToken = generateBlobSASQueryParameters(sasOptions, blobServiceClient.credential).toString();
    }
    const url = `${blobClient.url}?${sasToken}`;

    return new NextResponse(JSON.stringify({ url }), {
      status: HTTPResponses.OK,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    ailogger.error('Download file error:', error);
    return new NextResponse(
      JSON.stringify({
        error: 'Failed to download file',
        details: error.message || 'Unknown error'
      }),
      { status: HTTPResponses.INTERNAL_SERVER_ERROR }
    );
  }
}

// Handle file deletion with backward compatibility
async function handleDelete(params: FileOperationParams & { filename?: string }, scope: AuthorizedFileScope) {
  const { filename } = params;

  if (!filename) {
    return new NextResponse(JSON.stringify({ error: 'Filename is required' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  try {
    // F19: deletion targets only the schema-scoped container; legacy shared
    // containers are never touched from a user-facing path.
    const containerClient = await getContainerClient(scope.container, READ_ONLY_CONTAINER_OPTIONS);
    if (!containerClient) {
      return new NextResponse(JSON.stringify({ error: 'Failed to get container client' }), { status: HTTPResponses.INVALID_REQUEST });
    }

    const exists = await containerClient.exists();
    if (!exists) {
      return new NextResponse(JSON.stringify({ error: `Container not found: ${scope.container}` }), {
        status: HTTPResponses.NOT_FOUND
      });
    }

    const blobClient = containerClient.getBlobClient(filename);
    await blobClient.delete();

    return new NextResponse(JSON.stringify({ message: 'File deleted successfully' }), { status: HTTPResponses.OK });
  } catch (error: any) {
    ailogger.error('Delete file error:', error);
    return new NextResponse(
      JSON.stringify({
        error: 'Failed to delete file',
        details: error.message || 'Unknown error'
      }),
      { status: HTTPResponses.INTERNAL_SERVER_ERROR }
    );
  }
}

// Handle file listing with backward compatibility
async function handleList(scope: AuthorizedFileScope) {
  try {
    // F19: listing reads only the schema-scoped container; legacy shared
    // containers are never enumerated from a user-facing path.
    const containerClient = await getContainerClient(scope.container, READ_ONLY_CONTAINER_OPTIONS);
    if (!containerClient) {
      return new NextResponse(JSON.stringify({ error: 'Failed to get container client' }), { status: HTTPResponses.INVALID_REQUEST });
    }

    const exists = await containerClient.exists();
    if (!exists) {
      // Container doesn't exist - return empty list instead of error
      ailogger.info(`Container "${scope.container}" not found. Returning empty file list.`);
      return new NextResponse(
        JSON.stringify({
          responseMessage: 'No container found - empty list',
          blobData: []
        }),
        { status: HTTPResponses.OK }
      );
    }

    const blobData: any[] = [];
    const listOptions = {
      includeMetadata: true,
      includeVersions: false
    };

    let i = 0;
    for await (const blob of containerClient.listBlobsFlat(listOptions)) {
      if (!blob) {
        ailogger.error('blob is undefined');
        continue;
      }

      blobData.push({
        key: ++i,
        name: blob.name,
        user: blob.metadata?.user,
        formType: blob.metadata?.FormType,
        fileErrors: blob.metadata?.FileErrorState ? JSON.parse(blob.metadata?.FileErrorState as string) : '',
        date: blob.properties.lastModified
      });
    }

    return new NextResponse(
      JSON.stringify({
        responseMessage: 'List of files',
        blobData: blobData,
        containerName: scope.container // Include for debugging
      }),
      { status: HTTPResponses.OK }
    );
  } catch (error: any) {
    ailogger.error('File listing error:', error);
    return new NextResponse(
      JSON.stringify({
        error: 'Failed to list files',
        details: error.message || 'Unknown error'
      }),
      { status: HTTPResponses.INTERNAL_SERVER_ERROR }
    );
  }
}
