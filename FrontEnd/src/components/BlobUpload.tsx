import { BlobServiceClient } from '@azure/storage-blob';
import { FileWithPath } from 'react-dropzone';

const blobServiceClient = new BlobServiceClient(
  `https://forestgeostorage.blob.core.windows.net/?sv=2021-06-08&ss=b&srt=sco&sp=rwdlacitfx&se=2023-08-14T05:10:57Z&st=2022-08-13T21:10:57Z&spr=https&sig=3Ec7AhKV%2Bxx%2FeO78J3l6VeI8VAgwvRAbrR7m1UZXo0I%3D`
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
