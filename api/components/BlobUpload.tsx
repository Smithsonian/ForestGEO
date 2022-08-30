import { ParsedFile } from '@anzp/azure-function-multipart/dist/types/parsed-file.type';
import { BlobServiceClient } from '@azure/storage-blob';
require('dotenv').config();
const blobUrl: string = process.env.REACT_APP_BLOB_STR || undefined;
if (!blobUrl) {
  throw new Error('No string attached!');
}
const blobServiceClient = BlobServiceClient.fromConnectionString(blobUrl);
const containers: {name: string; nameShort: string}[] = [];
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const listContainers = async () => {
  for await (const container of blobServiceClient.listContainers()) {
    // figure out how to use metadata, for now using names to compare
    const containerName = container.name;
    const containerNameShort = container.name.replace(/[^a-z0-9]/gi, '');

    containers.push(
      { name: containerName, nameShort: containerNameShort });
  }
};

const uploadFiles = async (acceptedFilesList: ParsedFile[], plot: string) => {
  try {
    await listContainers();
    const plotReplaced = plot.replace(/[^a-z0-9]/gi, '').toLowerCase();
    const found = containers.find((container) => container.name === plotReplaced);
    if (found) {
      const containerForUpload = found.name;
      // console.log("Found in " + containerForUpload + "!");
    
    for (const file of acceptedFilesList) {
        const containerClient =
          blobServiceClient.getContainerClient(containerForUpload);
        const blobName = file.filename;
        const blobClient = containerClient.getBlockBlobClient(blobName);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const uploadBlob = await blobClient.upload(file.bufferFile, file.bufferFile.byteLength);          
    }
  } else {
    console.log('Plot ', plot, 'does not exist');
    alert('Plot ' + plot + ' does not exist');
  }
  } catch (e) {
    console.log(e);
  }
};

export { uploadFiles };
