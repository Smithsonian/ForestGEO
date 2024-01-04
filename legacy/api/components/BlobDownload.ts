import {BlobServiceClient} from "@azure/storage-blob";

require("dotenv").config();
const blobUrl: string = process.env.REACT_APP_BLOB_STR || undefined;
if (!blobUrl) {
  throw new Error("No string attached!");
}

export interface FileWithMetadata {
  fileName: {
    metaData: string
  }
  
}

const blobServiceClient = BlobServiceClient.fromConnectionString(blobUrl);

const containers: { name: string; nameShort: string }[] = [];

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const listContainers = async () => {
  for await (const container of blobServiceClient.listContainers()) {
    // figure out how to use metadata, for now using names to compare
    const containerName = container.name;
    const containerNameShort = containerName.replace(/[^a-z0-9]/gi, "");
    
    containers.push({name: containerName, nameShort: containerNameShort});
  }
};

const showFiles = async (plot: string) => {
  let blobData = {};
  try {
    await listContainers();
    const plotReplaced = plot.replace(/[^a-z0-9]/gi, "").toLowerCase();
    const found = containers.find(
      (container) => container.nameShort === plotReplaced
    );
    if (found) {
      const containerName = found.name;
      
      const containerClient =
        blobServiceClient.getContainerClient(containerName);
      
      for await (const blob of containerClient.listBlobsFlat({
        includeMetadata: true,
      })) {
        blobData[blob.name] = blob.metadata;
      }
      console.log('Backend blobData', blobData);
      return blobData;
    } else {
      console.log("Plot ", plot, "does not exist");
      alert("Plot " + plot + " does not exist");
      return null;
    }
  } catch (e) {
    console.log(e);
  }
};

export default showFiles;
