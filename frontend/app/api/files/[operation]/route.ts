import { NextRequest, NextResponse } from 'next/server';
import { getContainerClient, uploadValidFileAsBuffer } from '@/config/macros/azurestorage';
import { BlobSASPermissions, BlobServiceClient, generateBlobSASQueryParameters, StorageSharedKeyCredential } from '@azure/storage-blob';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';
import { getContainerNameWithFallback } from '@/config/macros/containernames';
import { auth } from '@/auth';
import { getSessionUserId, requireSession } from '@/lib/auth-helpers';
import { isValidSchema } from '@/config/utils/sqlsecurity';
import path from 'path';
import type { Session } from 'next-auth';
import { FormType, normalizeSourceFormat, SourceFormat } from '@/config/macros/formdetails';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

// Security: Allowed file extensions and MIME types
const ALLOWED_FILE_EXTENSIONS = ['.csv', '.txt', '.xlsx'] as const;
const ALLOWED_MIME_TYPES = ['text/csv', 'text/plain', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] as const;
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB limit

function sanitizeFileName(fileName: string): string {
  // Remove path separators and special characters
  const baseName = path.basename(fileName);
  // Allow only alphanumeric, dots, hyphens, underscores
  return baseName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function isValidFileExtension(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return ALLOWED_FILE_EXTENSIONS.includes(ext as any);
}

function isValidMimeType(mimeType: string): boolean {
  return ALLOWED_MIME_TYPES.includes(mimeType as any);
}

const READ_ONLY_CONTAINER_OPTIONS = { createIfMissing: false } as const;

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
  legacyContainer?: string;
  filename?: string;
  plotID?: string;
  plotName?: string;
  plot?: string;
  census?: string;
  user?: string;
  formType?: string;
  sourceFormat?: string;
}

interface AuthorizedFileScope {
  userId: string;
  primaryContainer: string;
  legacyContainer?: string;
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

function requestedContainersMatchScope(params: FileOperationParams, scope: Pick<AuthorizedFileScope, 'primaryContainer' | 'legacyContainer'>): boolean {
  const allowed = new Set([scope.primaryContainer, scope.legacyContainer].filter((name): name is string => Boolean(name)).map(name => name.toLowerCase()));
  const requested = [params.container, params.legacyContainer].map(normalizeContainerName).filter((name): name is string => Boolean(name));
  return requested.every(containerName => allowed.has(containerName));
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
  const plotName = params.plotName ?? params.plot;
  if (!plotID && !plotName) {
    return new NextResponse(JSON.stringify({ error: 'Either plotID or plotName parameter is required' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  let containerNames: { primary: string; legacy?: string };
  try {
    containerNames = getContainerNameWithFallback(plotID, plotName, censusNumber);
  } catch (error: any) {
    return new NextResponse(JSON.stringify({ error: error.message || 'Invalid plot or census identifier' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const scope = {
    userId,
    primaryContainer: containerNames.primary.toLowerCase(),
    legacyContainer: containerNames.legacy?.toLowerCase()
  };

  if (!requestedContainersMatchScope(params, scope)) {
    return new NextResponse(JSON.stringify({ error: 'Forbidden - container does not match authorized scope' }), { status: HTTPResponses.FORBIDDEN });
  }

  return scope;
}

/**
 * Unified file operations endpoint for Azure Storage
 * Handles upload, download, delete, and list operations
 */

// POST: Upload file
export async function POST(request: NextRequest, props: { params: Promise<{ operation: string }> }) {
  // Authentication check
  const session = await auth();
  const authError = requireSession(session);
  if (authError) return authError;

  const { operation } = await props.params;

  if (operation !== 'upload') {
    return new NextResponse(JSON.stringify({ error: 'POST method only supports upload operation' }), { status: HTTPResponses.METHOD_NOT_ALLOWED });
  }

  const params = extractParams(request);
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

  const { fileName, formType, sourceFormat } = params;
  const file = formData.get(fileName ?? 'file') as File | null;
  const fileRowErrors = formData.get('fileRowErrors') ? JSON.parse(formData.get('fileRowErrors') as string) : [];

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

  try {
    // getContainerClient now throws with detailed error messages on failure
    const containerClient = await getContainerClient(scope.primaryContainer);

    // uploadValidFileAsBuffer now always returns a response or throws
    const uploadResponse = await uploadValidFileAsBuffer(
      containerClient,
      file,
      scope.userId,
      formType,
      fileRowErrors,
      sanitizedFileName,
      normalizedSourceFormat
    );

    // Verify the response status
    if (uploadResponse._response.status < 200 || uploadResponse._response.status >= 300) {
      throw new Error(`Upload failed: Azure returned status ${uploadResponse._response.status}`);
    }

    ailogger.info(`File uploaded successfully: ${sanitizedFileName} by ${scope.userId}`);
    return new NextResponse(JSON.stringify({ message: 'File uploaded successfully' }), { status: HTTPResponses.OK });
  } catch (error: any) {
    // Log the full error for debugging but don't expose details to client
    ailogger.error(`File upload error for ${sanitizedFileName} (${scope.primaryContainer}): ${error.message}`);
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
export async function GET(request: NextRequest, props: { params: Promise<{ operation: string }> }) {
  const session = await auth();
  const authError = requireSession(session);
  if (authError) return authError;

  const { operation } = await props.params;

  if (!VALID_OPERATIONS[operation] || !['download', 'list'].includes(operation)) {
    return new NextResponse(JSON.stringify({ error: 'GET method supports download and list operations only' }), { status: HTTPResponses.METHOD_NOT_ALLOWED });
  }

  const params = extractParams(request);
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
export async function DELETE(request: NextRequest, props: { params: Promise<{ operation: string }> }) {
  const session = await auth();
  const authError = requireSession(session);
  if (authError) return authError;

  const { operation } = await props.params;

  if (operation !== 'delete') {
    return new NextResponse(JSON.stringify({ error: 'DELETE method only supports delete operation' }), { status: HTTPResponses.METHOD_NOT_ALLOWED });
  }

  const params = extractParams(request);
  const scope = authorizeFileScope(session!, params);
  if (scope instanceof NextResponse) return scope;
  return handleDelete(params, scope);
}

// Helper function to extract parameters from request
function extractParams(request: NextRequest): FileOperationParams & { fileName?: string } {
  const searchParams = request.nextUrl.searchParams;

  return {
    schema: searchParams.get('schema')?.trim() || undefined,
    container: searchParams.get('container')?.trim() || undefined,
    legacyContainer: searchParams.get('legacyContainer')?.trim() || undefined,
    filename: searchParams.get('filename')?.trim() || undefined,
    fileName: searchParams.get('fileName')?.trim() || undefined,
    plotID: searchParams.get('plotID')?.trim() || undefined,
    plotName: searchParams.get('plotName')?.trim() || undefined,
    plot: searchParams.get('plot')?.trim() || undefined,
    census: searchParams.get('census')?.trim() || undefined,
    user: searchParams.get('user')?.trim() || undefined,
    formType: searchParams.get('formType')?.trim() || undefined,
    sourceFormat: searchParams.get('sourceFormat')?.trim() || undefined
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
    let containerClient;
    let actualContainerName = '';

    // Try primary container first
    if (scope.primaryContainer) {
      containerClient = await getContainerClient(scope.primaryContainer, READ_ONLY_CONTAINER_OPTIONS);
      actualContainerName = scope.primaryContainer;

      // Check if container exists
      const exists = await containerClient?.exists();
      if (!exists) {
        ailogger.info(`Primary container "${actualContainerName}" not found, trying legacy...`);
        containerClient = null;
      }
    }

    // Fall back to legacy container if primary doesn't exist
    if (!containerClient && scope.legacyContainer) {
      containerClient = await getContainerClient(scope.legacyContainer, READ_ONLY_CONTAINER_OPTIONS);
      actualContainerName = scope.legacyContainer;

      const exists = await containerClient?.exists();
      if (!exists) {
        return new NextResponse(JSON.stringify({ error: `Container not found: ${scope.primaryContainer}` }), {
          status: HTTPResponses.NOT_FOUND
        });
      }

      ailogger.warn(`Using legacy container "${actualContainerName}" for download. Consider migrating to ID-based naming.`);
    }

    if (!containerClient) {
      return new NextResponse(JSON.stringify({ error: 'Failed to get container client' }), {
        status: HTTPResponses.INVALID_REQUEST
      });
    }

    const blobClient = containerClient.getBlobClient(filename);

    // Generate SAS token for secure download
    const sasOptions = {
      containerName: actualContainerName,
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
    let containerClient;
    let actualContainerName = '';

    // Try primary container first
    if (scope.primaryContainer) {
      containerClient = await getContainerClient(scope.primaryContainer, READ_ONLY_CONTAINER_OPTIONS);
      actualContainerName = scope.primaryContainer;

      const exists = await containerClient?.exists();
      if (!exists) {
        ailogger.info(`Primary container "${actualContainerName}" not found, trying legacy...`);
        containerClient = null;
      }
    }

    // Fall back to legacy container if primary doesn't exist
    if (!containerClient && scope.legacyContainer) {
      containerClient = await getContainerClient(scope.legacyContainer, READ_ONLY_CONTAINER_OPTIONS);
      actualContainerName = scope.legacyContainer;

      const exists = await containerClient?.exists();
      if (!exists) {
        return new NextResponse(JSON.stringify({ error: `Container not found: ${scope.primaryContainer}` }), {
          status: HTTPResponses.NOT_FOUND
        });
      }

      ailogger.warn(`Using legacy container "${actualContainerName}" for deletion. Consider migrating to ID-based naming.`);
    }

    if (!containerClient) {
      return new NextResponse(JSON.stringify({ error: 'Failed to get container client' }), { status: HTTPResponses.INVALID_REQUEST });
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
    let containerClient;
    let actualContainerName = '';

    // Try primary (ID-based) container first
    containerClient = await getContainerClient(scope.primaryContainer, READ_ONLY_CONTAINER_OPTIONS);
    actualContainerName = scope.primaryContainer;

    let exists = await containerClient?.exists();
    if (!exists && scope.legacyContainer) {
      // Fall back to legacy container
      ailogger.info(`Primary container "${actualContainerName}" not found, trying legacy "${scope.legacyContainer}"...`);
      containerClient = await getContainerClient(scope.legacyContainer, READ_ONLY_CONTAINER_OPTIONS);
      actualContainerName = scope.legacyContainer;

      exists = await containerClient?.exists();
      if (exists) {
        ailogger.warn(`Using legacy container "${actualContainerName}" for listing. Consider migrating to ID-based naming.`);
      }
    }

    if (!exists) {
      // Container doesn't exist - return empty list instead of error
      ailogger.info(`Container "${actualContainerName}" not found. Returning empty file list.`);
      return new NextResponse(
        JSON.stringify({
          responseMessage: 'No container found - empty list',
          blobData: []
        }),
        { status: HTTPResponses.OK }
      );
    }

    if (!containerClient) {
      return new NextResponse(JSON.stringify({ error: 'Failed to get container client' }), { status: HTTPResponses.INVALID_REQUEST });
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
        containerName: actualContainerName // Include for debugging
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
