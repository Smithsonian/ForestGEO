import { BlobServiceClient } from '@azure/storage-blob';

// const blobUrl = process.env.REACT_APP_BLOBURL || undefined;
// if (!blobUrl) {
//   throw new Error('No string attached!');
// }
const blobServiceClient = BlobServiceClient.fromConnectionString('SharedAccessSignature=sv=2021-04-10&ss=btqf&srt=sco&st=2022-08-18T21%3A39%3A57Z&se=2023-08-19T21%3A39%3A00Z&sp=rwl&sig=YbdX2fDELNCWJNkl9%2B%2BAMryTYBSqIYBP6XevMd9cdok%3D;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;QueueEndpoint=http://127.0.0.1:10001/devstoreaccount1;TableEndpoint=http://127.0.0.1:10002/devstoreaccount1;');
const containersNames: String[] = [];
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const listContainers = async () => {
  for await (const container of blobServiceClient.listContainers()) {
    containersNames.push(container.name);
  }
};

const uploadFiles = async (acceptedFilesList: any) => {
  try {
    await listContainers();
    for (const file of acceptedFilesList) {
      const fileName =
        file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
        console.log(fileName);
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
