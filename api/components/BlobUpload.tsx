import { ParsedFile } from '@anzp/azure-function-multipart/dist/types/parsed-file.type';
import { BlobServiceClient } from '@azure/storage-blob';
require('dotenv').config();
const blobUrl: string = process.env.REACT_APP_BLOB_STR || undefined;
if (!blobUrl) {
  throw new Error('No string attached!');
}
const blobServiceClient = BlobServiceClient.fromConnectionString(blobUrl);
const containersNames: String[] = [];
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const listContainers = async () => {
  for await (const container of blobServiceClient.listContainers()) {
    containersNames.push(container.name);
  }
};

const uploadFiles = async (acceptedFilesList: ParsedFile[]) => {
  try {
    await listContainers();
    for (const file of acceptedFilesList) {
      const fileName =
        file.filename.substring(0, file.filename.lastIndexOf('.')) || file.filename;
      if (containersNames.includes(fileName)) {
        const containerForUpload = fileName;
        const containerClient =
          blobServiceClient.getContainerClient(containerForUpload);
        const blobName = file.filename;
        const blobClient = containerClient.getBlockBlobClient(blobName);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const uploadBlob = await blobClient.upload(file.bufferFile, file.bufferFile.byteLength);
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
