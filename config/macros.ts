import {BlobServiceClient, ContainerClient} from "@azure/storage-blob";
import {FileRejection, FileWithPath} from "react-dropzone";
import {dataStructure} from "@/components/validationtable";
import sql from "mssql";

// INTERFACES
export interface Plot {
  key: string;
  num: number;
}

export interface UploadedFileData {
  key: number;
  name: string;
  user: string;
  date: Date;
}

/**
 * These are the only FileWithPath attributes we use.
 * // import { FileWithPath } from 'react-dropzone';
 */

export interface FileSize {
  path?: string;
  size: number;
  
  /** Can contain other fields, which we don't care about. */
  [otherFields: string]: any;
}

export interface FileListProps {
  acceptedFiles: FileSize[];
}

export interface FileErrors {
  [fileName: string]: { [currentRow: string]: string };
}

export interface UploadValidationProps {
  /** true when the upload is done,
   * false when it's not done.
   * Also false when upload hasn't started.
   */
  plot: Plot;
  
  uploadDone: boolean;
  /** true when the upload has started but not done. */
  isUploading: boolean;
  /** Keyed by filename, valued by a dict of errors for each row */
  errorsData: FileErrors;
  /** The files which have been set to be uploaded. */
  acceptedFiles: FileWithPath[];
  /** When an upload action is triggered. */
  handleUpload: () => Promise<void>;
  /** When the files are drag/dropped. */
  handleAcceptedFiles: (acceptedFiles: FileWithPath[]) => void;
}

export enum ReviewStates {
  PARSE = "parse",
  REVIEW = "review",
  UPLOAD = "upload",
  UPLOADED = "uploaded",
  ERRORS = "errors"
}

export interface ReviewValidationProps {
  /**
   * review process has 3 parts:
   * 1. parse uploaded files into output
   * 2. display rows to be uploaded and get user confirmation
   * 3a. error step: if there are errors, update table to show errors and STOP
   * 3b. upload step: if no errors, upload data and button to show data table
   */
  reviewState: ReviewStates;
  errorsData: FileErrors; // error data --> will be empty/null if no errors
  parsedData: { fileName: string; data: dataStructure[] }[]; // parsed data
  acceptedFiles: FileWithPath[];
}

export interface DropzonePureProps {
  /** Is someone dragging file(s) onto the dropzone? */
  isDragActive: boolean;
  /** From react-dropzone, function which gets  for putting properties */
  getRootProps: any;
  /** From react-dropzone, function which gets properties for the input field. */
  getInputProps: any;
}

export interface DropzoneProps {
  /**
   * A callback function which is called when files given for upload.
   * Files can be given by the user either by dropping the files
   * with drag and drop, or by using the file viewfiles button.
   *
   * @param acceptedFiles - files which were accepted for upload.
   * @param rejectedFiles - files which are denied uploading.
   */
  onChange(acceptedFiles: FileWithPath[], rejectedFiles: FileRejection[]): void;
}

// CONSTANT MACROS
export const fileColumns = [
  {key: 'name', label: 'File Name'},
  {key: 'date', label: 'Date Entered'},
  {key: 'user', label: 'Uploaded By'},
]

export const plots: Plot[] = [
  {key: "Amacayacu", num: 16},
  {key: "BCI", num: 40},
  {key: "bukittimah", num: 22},
  {key: "Cocoli", num: 39},
  {key: "CRC", num: 1},
  {key: "CTFS-Panama", num: 11},
  {key: "Danum", num: 36},
  {key: "Harvard Forest", num: 9},
  {key: "Heishiding", num: 4},
  {key: "HKK", num: 19},
  {key: "ituri_all", num: 24},
  {key: "khaochong", num: 38},
  {key: "Korup", num: 10},
  {key: "korup3census", num: 32},
  {key: "Lambir", num: 35},
  {key: "Lilly_Dickey", num: 41},
  {key: "Luquillo", num: 25},
  {key: "Mpala", num: 3},
  {key: "osfdp", num: 37},
  {key: "pasoh", num: 15},
  {key: "Rabi", num: 17},
  {key: "Scotty Creek", num: 8},
  {key: "SERC", num: 7},
  {key: "Sinharaja", num: 26},
  {key: "Speulderbos", num: 29},
  {key: "Stable_bukittimah", num: 27},
  {key: "stable_pasoh", num: 28},
  {key: "Traunstein", num: 34},
  {key: "Tyson", num: 23},
  {key: "UMBC", num: 18},
  {key: "Utah", num: 30},
  {key: "Vandermeer", num: 14},
  {key: "wanang", num: 21},
  {key: "Yosemite", num: 33},
];
export const siteConfig = {
  name: "ForestGEO",
  description: "Census data entry and data",
  navItems: [
    {
      label: 'Dashboard',
      href: '/dashboard'
    },
    {
      label: "Files",
      href: "/files",
    },
    {
      label: "Data",
      href: "/data",
    },
  ]
};
export const sqlConfig: any = {
  user: process.env.AZURE_SQL_USER!, // better stored in an app setting such as process.env.DB_USER
  password: process.env.AZURE_SQL_PASSWORD!, // better stored in an app setting such as process.env.DB_PASSWORD
  server: process.env.AZURE_SQL_SERVER!, // better stored in an app setting such as process.env.DB_SERVER
  port: parseInt(process.env.AZURE_SQL_PORT!), // optional, defaults to 1433, better stored in an app setting such as process.env.DB_PORT
  database: process.env.AZURE_SQL_DATABASE!, // better stored in an app setting such as process.env.DB_NAME
  authentication: {
    type: 'default'
  },
  options: {
    encrypt: true
  }
}

export const headers = [
  "Tag",
  "Subquadrat",
  "SpCode",
  "DBH",
  "Htmeas",
  "Codes",
  "Comments",
];

export const tableHeaders = [
  // @todo: these are hardcoded.
  {key: 0, label: 'Tag'},
  {key: 1, label: 'Subquadrat'},
  {key: 2, label: 'SpCode'},
  {key: 3, label: 'DBH'},
  {key: 4, label: 'Htmeas'},
  {key: 5, label: 'Codes'},
  {key: 6, label: 'Comments'},
]

export const backgrounds = [
  "background-1.jpg",
  "background-2.jpg",
  "background-3.jpg",
  "background-4.jpg",
]

/**
 * SQL FUNCTIONS
 */
export function updateOrInsert(row: any, plot: string) {
  return `
      IF EXISTS (SELECT * FROM [plot_${plot.toLowerCase()}] WHERE Tag = ${parseInt(row['Tag'])})
        UPDATE [plot_${plot.toLowerCase()}]
        SET Subquadrat = ${parseInt(row['Subquadrat'])}, SpCode = ${parseInt(row['SpCode'])}, DBH = ${parseFloat(row['DBH'])}, Htmeas = ${parseFloat(row['Htmeas'])}, Codes = '${row['Codes']}', Comments = '${row['Comments']}'
        WHERE Tag = ${parseInt(row['Tag'])};
      ELSE
        SELECT * FROM [plot_${plot.toLowerCase()}] WHERE Tag = ${parseInt(row['Tag'])};
    `;
}

export function selectAllRows(plot: string) {
  return `SELECT * FROM [plot_${plot.toLowerCase()}]`;
}


/**
 * CONTAINER STORAGE FUNCTIONS
 */


export async function getContainerClient(plot: string) {
  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  const storageAccountConnectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!accountName || !storageAccountConnectionString) throw new Error("process envs failed");
  // create client pointing to AZ storage system from connection string from Azure portal
  const blobServiceClient = BlobServiceClient.fromConnectionString(storageAccountConnectionString);
  if (!blobServiceClient) throw new Error("blob service client creation failed");
  // attempt connection to pre-existing container --> additional check to see if container was found
  return blobServiceClient.getContainerClient(plot.toLowerCase());
}

export async function uploadFileAsBuffer(containerClient: ContainerClient, file: File, user: string) {
  const buffer = Buffer.from(await file.arrayBuffer());
  console.log(`blob name: ${file.name}`);
  let metadata = {
    user: user,
  };
  // create connection & client facing new blob
  // async command to upload buffer via client, waiting for response
  let uploadResponse = await containerClient.getBlockBlobClient(file.name).uploadData(buffer);
  let metadataResults = await containerClient.getBlobClient(file.name).setMetadata(metadata);
  if (metadataResults.errorCode) throw new Error('metadata set failed.');
  return uploadResponse;
}