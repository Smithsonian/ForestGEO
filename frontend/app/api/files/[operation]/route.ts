import { NextRequest, NextResponse } from 'next/server';
import { getContainerClient, uploadValidFileAsBuffer } from '@/config/macros/azurestorage';
import { BlobSASPermissions, BlobServiceClient, generateBlobSASQueryParameters, StorageSharedKeyCredential } from '@azure/storage-blob';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';
import { getContainerNameWithFallback } from '@/config/macros/containernames';
import { auth } from '@/auth';
import path from 'path';

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

type FileOperation = 'upload' | 'download' | 'delete' | 'list';

const VALID_OPERATIONS: Record<string, FileOperation> = {
  upload: 'upload',
  download: 'download',
  delete: 'delete',
  list: 'list'
} as const;

interface FileOperationParams {
  container?: string;
  legacyContainer?: string;
  filename?: string;
  plotID?: string;
  plotName?: string;
  plot?: string;
  census?: string;
  user?: string;
  formType?: string;
}

/**
 * Unified file operations endpoint for Azure Storage
 * Handles upload, download, delete, and list operations
 */

// POST: Upload file
export async function POST(request: NextRequest, props: { params: Promise<{ operation: string }> }) {
  // Authentication check
  const session = await auth();
  if (!session?.user) {
    ailogger.warn('Unauthorized file upload attempt - no session');
    return new NextResponse(JSON.stringify({ error: 'Unauthorized - authentication required' }), { status: 401 }); // 401 Unauthorized
  }

  const { operation } = await props.params;

  if (operation !== 'upload') {
    return new NextResponse(JSON.stringify({ error: 'POST method only supports upload operation' }), { status: HTTPResponses.METHOD_NOT_ALLOWED });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
    if (formData === null || formData === undefined || formData.entries().next().done) {
      throw new Error('No form data provided');
    }
  } catch {
    return new NextResponse(JSON.stringify({ error: 'File is required' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const params = extractParams(request);
  const { fileName, plot, census, user, formType } = params;
  const file = formData.get(fileName ?? 'file') as File | null;
  const fileRowErrors = formData.get('fileRowErrors') ? JSON.parse(formData.get('fileRowErrors') as string) : [];

  // Validate required parameters for upload
  if (!file || !fileName || !plot || !census || !user || !formType) {
    return new NextResponse(JSON.stringify({ error: 'Missing required parameters: fileName, plot, census, user, formType, and file' }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }

  // Security validations
  // 1. File size check
  if (file.size > MAX_FILE_SIZE) {
    ailogger.warn(`File too large: ${file.size} bytes (max: ${MAX_FILE_SIZE})`);
    return new NextResponse(JSON.stringify({ error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB` }), {
      status: 413 // 413 Payload Too Large
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

  // 5. Validate container name components (plot and census)
  const plotSanitized = plot.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
  const censusSanitized = census.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();

  if (plotSanitized.length === 0 || censusSanitized.length === 0) {
    return new NextResponse(JSON.stringify({ error: 'Invalid plot or census identifier' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  try {
    const containerClient = await getContainerClient(`${plotSanitized}-${censusSanitized}`);
    if (!containerClient) {
      throw new Error('Failed to get container client');
    }

    const uploadResponse = await uploadValidFileAsBuffer(containerClient, file, user, formType, fileRowErrors);
    if (uploadResponse && (uploadResponse._response.status < 200 || uploadResponse._response.status >= 300)) {
      throw new Error('Upload failed: Response status not between 200 & 299');
    }

    ailogger.info(`File uploaded successfully: ${sanitizedFileName} by ${session.user.email}`);
    return new NextResponse(JSON.stringify({ message: 'File uploaded successfully' }), { status: HTTPResponses.OK });
  } catch (error: any) {
    ailogger.error('File upload error:', error);
    return new NextResponse(
      JSON.stringify({
        error: 'Failed to upload file'
        // Do not expose internal error details to client
      }),
      { status: HTTPResponses.INTERNAL_SERVER_ERROR }
    );
  }
}

// GET: Download file or list files
export async function GET(request: NextRequest, props: { params: Promise<{ operation: string }> }) {
  const { operation } = await props.params;

  if (!VALID_OPERATIONS[operation] || !['download', 'list'].includes(operation)) {
    return new NextResponse(JSON.stringify({ error: 'GET method supports download and list operations only' }), { status: HTTPResponses.METHOD_NOT_ALLOWED });
  }

  const params = extractParams(request);

  if (operation === 'download') {
    return handleDownload(params);
  } else if (operation === 'list') {
    return handleList(params);
  }

  return new NextResponse(JSON.stringify({ error: 'Invalid operation' }), { status: HTTPResponses.INVALID_REQUEST });
}

// DELETE: Delete file
export async function DELETE(request: NextRequest, props: { params: Promise<{ operation: string }> }) {
  const { operation } = await props.params;

  if (operation !== 'delete') {
    return new NextResponse(JSON.stringify({ error: 'DELETE method only supports delete operation' }), { status: HTTPResponses.METHOD_NOT_ALLOWED });
  }

  const params = extractParams(request);
  return handleDelete(params);
}

// Helper function to extract parameters from request
function extractParams(request: NextRequest): FileOperationParams & { fileName?: string } {
  const searchParams = request.nextUrl.searchParams;

  return {
    container: searchParams.get('container')?.trim() || undefined,
    legacyContainer: searchParams.get('legacyContainer')?.trim() || undefined,
    filename: searchParams.get('filename')?.trim() || undefined,
    fileName: searchParams.get('fileName')?.trim() || undefined,
    plotID: searchParams.get('plotID')?.trim() || undefined,
    plotName: searchParams.get('plotName')?.trim() || undefined,
    plot: searchParams.get('plot')?.trim() || undefined,
    census: searchParams.get('census')?.trim() || undefined,
    user: searchParams.get('user')?.trim() || undefined,
    formType: searchParams.get('formType')?.trim() || undefined
  };
}

// Handle file download with backward compatibility
async function handleDownload(params: FileOperationParams & { filename?: string }) {
  const { container, legacyContainer, filename } = params;
  const storageAccountConnectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;

  if (!filename || !storageAccountConnectionString) {
    return new NextResponse(JSON.stringify({ error: 'Filename and storage connection string are required' }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }

  if (!container && !legacyContainer) {
    return new NextResponse(JSON.stringify({ error: 'Container name is required' }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }

  try {
    const blobServiceClient = BlobServiceClient.fromConnectionString(storageAccountConnectionString);
    let containerClient;
    let actualContainerName = '';

    // Try primary container first
    if (container) {
      containerClient = await getContainerClient(container.toLowerCase());
      actualContainerName = container.toLowerCase();

      // Check if container exists
      const exists = await containerClient?.exists();
      if (!exists) {
        ailogger.info(`Primary container "${actualContainerName}" not found, trying legacy...`);
        containerClient = null;
      }
    }

    // Fall back to legacy container if primary doesn't exist
    if (!containerClient && legacyContainer) {
      containerClient = await getContainerClient(legacyContainer.toLowerCase());
      actualContainerName = legacyContainer.toLowerCase();

      const exists = await containerClient?.exists();
      if (!exists) {
        return new NextResponse(JSON.stringify({ error: `Container not found: ${container || legacyContainer}` }), {
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
async function handleDelete(params: FileOperationParams & { filename?: string }) {
  const { container, legacyContainer, filename } = params;

  if (!filename) {
    return new NextResponse(JSON.stringify({ error: 'Filename is required' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  if (!container && !legacyContainer) {
    return new NextResponse(JSON.stringify({ error: 'Container name is required' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  try {
    let containerClient;
    let actualContainerName = '';

    // Try primary container first
    if (container) {
      containerClient = await getContainerClient(container.toLowerCase());
      actualContainerName = container.toLowerCase();

      const exists = await containerClient?.exists();
      if (!exists) {
        ailogger.info(`Primary container "${actualContainerName}" not found, trying legacy...`);
        containerClient = null;
      }
    }

    // Fall back to legacy container if primary doesn't exist
    if (!containerClient && legacyContainer) {
      containerClient = await getContainerClient(legacyContainer.toLowerCase());
      actualContainerName = legacyContainer.toLowerCase();

      const exists = await containerClient?.exists();
      if (!exists) {
        return new NextResponse(JSON.stringify({ error: `Container not found: ${container || legacyContainer}` }), {
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
async function handleList(params: FileOperationParams) {
  const { plotID, plotName, census } = params;

  if (!census) {
    return new NextResponse(JSON.stringify({ error: 'Census parameter is required' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  if (!plotID && !plotName) {
    return new NextResponse(JSON.stringify({ error: 'Either plotID or plotName parameter is required' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  try {
    // Generate container names with fallback
    const censusNum = parseInt(census, 10);
    const plotIdNum = plotID ? parseInt(plotID, 10) : undefined;

    const { primary, legacy } = getContainerNameWithFallback(plotIdNum, plotName, censusNum);

    let containerClient;
    let actualContainerName = '';

    // Try primary (ID-based) container first
    containerClient = await getContainerClient(primary.toLowerCase());
    actualContainerName = primary.toLowerCase();

    let exists = await containerClient?.exists();
    if (!exists && legacy) {
      // Fall back to legacy container
      ailogger.info(`Primary container "${actualContainerName}" not found, trying legacy "${legacy}"...`);
      containerClient = await getContainerClient(legacy.toLowerCase());
      actualContainerName = legacy.toLowerCase();

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
