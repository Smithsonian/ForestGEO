import { BlobServiceClient, BlobUploadCommonResponse, ContainerClient } from '@azure/storage-blob';
import ailogger from '@/ailogger';

interface GetContainerClientOptions {
  createIfMissing?: boolean;
}

function getBlobServiceClient(): BlobServiceClient {
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

export async function uploadValidFileAsBuffer(
  containerClient: ContainerClient,
  file: File,
  user: string,
  formType: string,
  fileRowErrors: FileRowErrors[] = [],
  blobFileName: string = file.name,
  sourceFormat: string = 'csv'
): Promise<BlobUploadCommonResponse> {
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

  const newFileName = await generateNewFileName(blobFileName);
  ailogger.info(`Uploading blob: ${newFileName}`);

  // Prepare metadata
  const metadata = {
    user: user,
    FormType: formType,
    sourceformat: sourceFormat,
    FileErrorState: JSON.stringify(fileRowErrors.length > 0 ? fileRowErrors : [])
  };

  // Retry mechanism for the upload
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Use the generated unique filename (newFileName), not the original file.name
      const uploadResponse = await containerClient.getBlockBlobClient(newFileName).uploadData(buffer, { metadata });

      // uploadData always returns a response on success
      ailogger.info(`Upload successful for ${newFileName} on attempt ${attempt}`);
      return uploadResponse;
    } catch (error: any) {
      lastError = error;
      ailogger.warn(`Upload attempt ${attempt}/${MAX_RETRIES} failed for ${newFileName}: ${error.message}`);
      if (attempt < MAX_RETRIES) {
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
