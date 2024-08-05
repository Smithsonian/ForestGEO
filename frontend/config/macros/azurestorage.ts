import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';

export async function getContainerClient(containerName: string) {
  const storageAccountConnectionString = process.env.AZURE_STORAGE_CONNECTION_STRING!;
  console.log('Connection String:', storageAccountConnectionString);
  console.log(`container name: ${containerName.toLowerCase()}`);
  if (!storageAccountConnectionString) {
    console.error('process envs failed');
    throw new Error('process envs failed');
  }
  // create client pointing to AZ storage system from connection string from Azure portal
  const blobServiceClient = BlobServiceClient.fromConnectionString(storageAccountConnectionString);
  if (!blobServiceClient) console.error('blob service client creation failed');
  else console.error('blob service client created & connected');
  // attempt connection to pre-existing container --> additional check to see if container was found
  const containerClient = blobServiceClient.getContainerClient(containerName.toLowerCase());
  console.log(containerClient.url);
  if (!(await containerClient.createIfNotExists())) console.error('container client createifnotexists failure');
  else {
    console.log(`container client with name ${containerName.toLowerCase()} created and accessed.`);
    return containerClient;
  }
}

/**
 * CONTAINER STORAGE FUNCTIONS
 *
 * need a type to store validation errors by row per file
 * row per file can be stored as FileRowSet?
 */
const MAX_RETRIES = 3; // Maximum number of retries

const RETRY_DELAY_MS = 3000; // Delay between retries in milliseconds

export const FORMSEARCH_LIMIT: number = 5;
export type FileRowErrors = {
  stemtag: string;
  tag: string;
  validationErrorID: number;
};

export async function uploadValidFileAsBuffer(
  containerClient: ContainerClient,
  file: File,
  user: string,
  formType: string,
  fileRowErrors: FileRowErrors[] = []
) {
  const buffer = Buffer.from(await file.arrayBuffer());
  // New function to generate the filename with an incremented suffix
  const generateNewFileName = async (fileName: string) => {
    let newFileName = fileName;
    let match;
    let index = 0;

    // Regex to find if the filename has a suffix pattern like _1, _2, etc.
    const regex = /^(.+)(_)(\d+)(\..+)$/;

    do {
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

  const newFileName = await generateNewFileName(file.name);
  console.log(`Uploading blob: ${newFileName}`);

  // Prepare metadata
  const metadata = {
    user: user,
    FormType: formType,
    FileErrorState: JSON.stringify(fileRowErrors.length > 0 ? fileRowErrors : [])
  };

  // Retry mechanism for the upload
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const uploadResponse = await containerClient.getBlockBlobClient(file.name).uploadData(buffer, { metadata });

      // If upload is successful, return the response
      if (uploadResponse) {
        console.log(`Upload successful on attempt ${attempt}: ${file.name}`);
        return uploadResponse;
      }
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        console.log(`Upload attempt ${attempt} failed for ${file.name}, retrying in ${RETRY_DELAY_MS}ms...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      } else {
        // If all attempts fail, rethrow the error
        console.error(`All upload attempts failed for ${file.name}`);
        throw error;
      }
    }
  }
}
