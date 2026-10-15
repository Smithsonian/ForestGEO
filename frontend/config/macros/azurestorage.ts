import { BlobServiceClient, BlobUploadCommonResponse, ContainerClient } from '@azure/storage-blob';
import ailogger from '@/ailogger';

interface GetContainerClientOptions {
  createIfMissing?: boolean;
}

export function getBlobServiceClient(): BlobServiceClient {
  const storageAccountConnectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!storageAccountConnectionString) {
    const errorMsg = 'AZURE_STORAGE_CONNECTION_STRING environment variable is not set';
    ailogger.error(errorMsg);
    throw new Error(errorMsg);
  }

  // Validate connection string format before attempting to use it
  if (!storageAccountConnectionString.includes('AccountName=') || !storageAccountConnectionString.includes('AccountKey=')) {
    const errorMsg = 'AZURE_STORAGE_CONNECTION_STRING appears to be invalid (missing AccountName or AccountKey)';
    ailogger.error(errorMsg);
    throw new Error(errorMsg);
  }

  let blobServiceClient: BlobServiceClient;
  try {
    // BlobServiceClient.fromConnectionString throws on invalid connection string
    blobServiceClient = BlobServiceClient.fromConnectionString(storageAccountConnectionString);
  } catch (error: any) {
    const errorMsg = `Failed to create BlobServiceClient: ${error.message}`;
    ailogger.error(errorMsg);
    throw new Error(errorMsg);
  }

  ailogger.info('blob service client created & connected');
  return blobServiceClient;
}

export async function getContainerClient(containerName: string, options: GetContainerClientOptions = {}): Promise<ContainerClient> {
  const { createIfMissing = true } = options;
  const blobServiceClient = getBlobServiceClient();

  // attempt connection to pre-existing container --> additional check to see if container was found
  const containerClient = blobServiceClient.getContainerClient(containerName.toLowerCase());

  if (!createIfMissing) {
    return containerClient;
  }

  try {
    // createIfNotExists returns { succeeded: true } if created, { succeeded: false } if already exists
    // Both cases are valid - we just need the container to exist
    const createResult = await containerClient.createIfNotExists();
    if (createResult.succeeded) {
      ailogger.info(`Container '${containerName.toLowerCase()}' created successfully`);
    } else {
      ailogger.info(`Container '${containerName.toLowerCase()}' already exists`);
    }
  } catch (error: any) {
    const errorMsg = `Failed to create/access container '${containerName.toLowerCase()}': ${error.message}`;
    ailogger.error(errorMsg);
    throw new Error(errorMsg);
  }

  return containerClient;
}

/**
 * CONTAINER STORAGE FUNCTIONS
 *
 * need a type to store validation errors by row per file
 * row per file can be stored as FileRowSet?
 */
const MAX_RETRIES = 3; // Maximum number of retries

const RETRY_DELAY_MS = 3000; // Delay between retries in milliseconds

export const FORMSEARCH_LIMIT = 5;

export interface FileRowErrors {
  stemtag: string;
  tag: string;
  validationErrorID: number;
}

export interface UploadValidFileResult {
  response: BlobUploadCommonResponse;
  blobName: string;
}

/**
 * Identifies the upload attempt a blob belongs to.
 *
 * When supplied, the blob is written EXACTLY at `blobFileName` with create-only
 * semantics instead of the probe-then-write suffix search. That search is a
 * TOCTOU race: `exists()` followed by an unconditional `uploadData()` lets two
 * concurrent attempts both see a name free and both claim it, after which either
 * attempt's cleanup can delete a blob the other is relying on. An attempt-scoped
 * path plus an atomic create removes both halves of that.
 *
 * The attempt id is also written to blob metadata so job creation can require
 * that a referenced blob was uploaded by this user, under this attempt.
 */
export interface UploadAttemptBinding {
  attemptID: string;
}

/** Azure's create-only conflict: the blob path is already taken. */
function isBlobAlreadyExistsError(error: unknown): boolean {
  const candidate = error as { statusCode?: number; code?: string; details?: { errorCode?: string } } | null;
  return candidate?.statusCode === 409 || candidate?.code === 'BlobAlreadyExists' || candidate?.details?.errorCode === 'BlobAlreadyExists';
}

export async function uploadValidFileAsBufferWithMetadata(
  containerClient: ContainerClient,
  file: File,
  user: string,
  formType: string,
  fileRowErrors: FileRowErrors[] = [],
  blobFileName: string = file.name,
  sourceFormat: string = 'csv',
  attempt?: UploadAttemptBinding
): Promise<UploadValidFileResult> {
  let buffer: Buffer;
  try {
    buffer = Buffer.from(await file.arrayBuffer());
  } catch (error: any) {
    const errorMsg = `Failed to read file buffer for ${file.name}: ${error.message}`;
    ailogger.error(errorMsg);
    throw new Error(errorMsg);
  }

  // New function to generate the filename with an incremented suffix
  const generateNewFileName = async (fileName: string): Promise<string> => {
    let newFileName = fileName;
    let match;
    let index = 0;
    const MAX_ITERATIONS = 1000; // CRITICAL FIX: Prevent infinite loop
    let iterations = 0;

    // Regex to find if the filename has a suffix pattern like _1, _2, etc.
    const regex = /^(.+)(_)(\d+)(\..+)$/;

    do {
      iterations++;
      if (iterations > MAX_ITERATIONS) {
        throw new Error(`Failed to generate unique filename after ${MAX_ITERATIONS} attempts`);
      }

      const fileExists = await containerClient.getBlockBlobClient(newFileName).exists();
      if (!fileExists) break;

      match = newFileName.match(regex);
      if (match) {
        index = parseInt(match[3], 10) + 1;
        newFileName = `${match[1]}_${index}${match[4]}`;
      } else {
        const parts = newFileName.split('.');
        parts[0] += `_${index + 1}`;
        newFileName = parts.join('.');
      }
    } while (true);

    return newFileName;
  };

  // An attempt-bound upload owns its path outright, so there is nothing to
  // probe for and nothing to suffix — the name is either free (this attempt has
  // not written it) or the write is a genuine conflict worth surfacing.
  const newFileName = attempt ? blobFileName : await generateNewFileName(blobFileName);
  ailogger.info(`Uploading blob: ${newFileName}`);

  // Prepare metadata
  const metadata: Record<string, string> = {
    user: user,
    FormType: formType,
    sourceformat: sourceFormat,
    FileErrorState: JSON.stringify(fileRowErrors.length > 0 ? fileRowErrors : [])
  };
  if (attempt) metadata.attemptid = attempt.attemptID;

  // ifNoneMatch '*' is "create only": the write fails rather than overwriting an
  // existing blob, which is the atomicity `exists()` could never provide.
  const uploadOptions = attempt ? { metadata, conditions: { ifNoneMatch: '*' } } : { metadata };

  // Retry mechanism for the upload
  const attemptBoundUpload = attempt !== undefined;
  let lastError: Error | null = null;
  for (let attemptNumber = 1; attemptNumber <= MAX_RETRIES; attemptNumber++) {
    try {
      // Use the generated unique filename (newFileName), not the original file.name
      const uploadResponse = await containerClient.getBlockBlobClient(newFileName).uploadData(buffer, uploadOptions);

      // uploadData always returns a response on success
      ailogger.info(`Upload successful for ${newFileName} on attempt ${attemptNumber}`);
      return { response: uploadResponse, blobName: newFileName };
    } catch (error: any) {
      lastError = error;
      // A create-only write that reports "already exists" on a RETRY is this
      // same upload's earlier attempt whose acknowledgement was lost — same
      // attempt path, same bytes. Retrying past it would fail forever, so it is
      // reported as the success it is. On the FIRST attempt the same error means
      // something else already owns the path, which is a genuine conflict.
      if (attemptBoundUpload && attemptNumber > 1 && isBlobAlreadyExistsError(error)) {
        ailogger.info(`Blob ${newFileName} already exists on retry ${attemptNumber}; a previous attempt of this upload committed it.`);
        return { response: error.response ?? ({ _response: { status: 201 } } as unknown as BlobUploadCommonResponse), blobName: newFileName };
      }
      ailogger.warn(`Upload attempt ${attemptNumber}/${MAX_RETRIES} failed for ${newFileName}: ${error.message}`);
      if (attemptBoundUpload && isBlobAlreadyExistsError(error)) {
        throw new Error(`Blob ${newFileName} already exists for this upload attempt; refusing to overwrite it.`);
      }
      if (attemptNumber < MAX_RETRIES) {
        ailogger.info(`Retrying in ${RETRY_DELAY_MS}ms...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }

  // If we get here, all retries failed
  const errorMsg = `All ${MAX_RETRIES} upload attempts failed for ${newFileName}`;
  ailogger.error(errorMsg, lastError ?? undefined);
  throw new Error(`${errorMsg}: ${lastError?.message || 'Unknown error'}`);
}

export async function uploadValidFileAsBuffer(
  containerClient: ContainerClient,
  file: File,
  user: string,
  formType: string,
  fileRowErrors: FileRowErrors[] = [],
  blobFileName: string = file.name,
  sourceFormat: string = 'csv'
): Promise<BlobUploadCommonResponse> {
  const result = await uploadValidFileAsBufferWithMetadata(containerClient, file, user, formType, fileRowErrors, blobFileName, sourceFormat);
  return result.response;
}
