import { BlobServiceClient } from '@azure/storage-blob';
import { FileWithPath } from 'react-dropzone';

const AZURE_STORAGE_CONNECTION_STRING =
  process.env.REACT_APP_AZURE_STORAGE_CONNECTION_STRING;

if (!AZURE_STORAGE_CONNECTION_STRING) {
  throw Error('Azure Storage Connection string not found');
}

const blobServiceClient = BlobServiceClient.fromConnectionString(
  AZURE_STORAGE_CONNECTION_STRING
);

const containersNames: String[] = [];
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const listContainers = async () => {
  for await (const container of blobServiceClient.listContainers()) {
    containersNames.push(container.name);
  }
};

const uploadFiles = async (acceptedFilesList: FileWithPath[]) => {
  try {
    await listContainers();
    for (const file of acceptedFilesList) {
      const fileName =
        file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
      if (containersNames.includes(fileName)) {
        const containerForUpload = fileName;
        const containerClient =
          blobServiceClient.getContainerClient(containerForUpload);
        const blobName = file.name;
        const blobClient = containerClient.getBlockBlobClient(blobName);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const uploadBlob = await blobClient.upload(file, file.size);
      } else {
        console.log('Plot ', fileName, 'does not exist');
        alert('Plot ' + fileName + ' does not exist');
      }
    }
  } catch (e) {
    console.log(e);
  }
};

export { uploadFiles };
