import { NextRequest, NextResponse } from 'next/server';
import { getContainerClient, uploadValidFileAsBuffer } from '@/config/macros/azurestorage';
import { BlobSASPermissions, BlobServiceClient, generateBlobSASQueryParameters, StorageSharedKeyCredential } from '@azure/storage-blob';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';

type FileOperation = 'upload' | 'download' | 'delete' | 'list';

const VALID_OPERATIONS: Record<string, FileOperation> = {
  upload: 'upload',
  download: 'download',
  delete: 'delete',
  list: 'list'
} as const;

interface FileOperationParams {
  container?: string;
  filename?: string;
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
  } catch (error) {
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

  try {
    const containerClient = await getContainerClient(`${plot.toLowerCase()}-${census.toLowerCase()}`);
    if (!containerClient) {
      throw new Error('Failed to get container client');
    }

    const uploadResponse = await uploadValidFileAsBuffer(containerClient, file, user, formType, fileRowErrors);
    if (uploadResponse && (uploadResponse._response.status < 200 || uploadResponse._response.status >= 300)) {
      throw new Error('Upload failed: Response status not between 200 & 299');
    }

    return new NextResponse(JSON.stringify({ message: 'File uploaded successfully' }), { status: HTTPResponses.OK });
  } catch (error: any) {
    ailogger.error('File upload error:', error);
    return new NextResponse(
      JSON.stringify({
        error: 'Failed to upload file',
        details: error.message || 'Unknown error'
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
    filename: searchParams.get('filename')?.trim() || undefined,
    fileName: searchParams.get('fileName')?.trim() || undefined,
    plot: searchParams.get('plot')?.trim() || undefined,
    census: searchParams.get('census')?.trim() || undefined,
    user: searchParams.get('user')?.trim() || undefined,
    formType: searchParams.get('formType')?.trim() || undefined
  };
}

// Handle file download
async function handleDownload(params: FileOperationParams & { filename?: string }) {
  const { container, filename } = params;
  const storageAccountConnectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;

  if (!container || !filename || !storageAccountConnectionString) {
    return new NextResponse(JSON.stringify({ error: 'Container name, filename, and storage connection string are required' }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }

  try {
    const containerClient = await getContainerClient(container.toLowerCase());
    if (!containerClient) {
      return new NextResponse(JSON.stringify({ error: 'Failed to get container client' }), { status: HTTPResponses.INVALID_REQUEST });
    }

    const blobServiceClient = BlobServiceClient.fromConnectionString(storageAccountConnectionString);
    const blobClient = containerClient.getBlobClient(filename);

    // Generate SAS token for secure download
    const sasOptions = {
      containerName: container,
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

// Handle file deletion
async function handleDelete(params: FileOperationParams & { filename?: string }) {
  const { container, filename } = params;

  if (!container || !filename) {
    return new NextResponse(JSON.stringify({ error: 'Container name and filename are required' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  try {
    const containerClient = await getContainerClient(container.toLowerCase());
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

// Handle file listing
async function handleList(params: FileOperationParams) {
  const { plot, census } = params;

  if (!plot || !census) {
    return new NextResponse(JSON.stringify({ error: 'Both plot and census parameters are required' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  try {
    const containerClient = await getContainerClient(`${plot}-${census}`);
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
        blobData: blobData
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
