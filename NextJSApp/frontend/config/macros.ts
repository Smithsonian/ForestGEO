import {BlobServiceClient, ContainerClient} from "@azure/storage-blob";
import {FileRejection, FileWithPath} from "react-dropzone";
import {GridCellParams, GridColDef} from "@mui/x-data-grid";
import '@/styles/customtablesettings.css'
import clsx from "clsx";

// INTERFACES
export interface Plot {
  key: string;
  num: number;
}

export interface UploadedFileData {
  key: number;
  name: string;
  user: string;
  errors: string;
  version: string;
  isCurrentVersion: boolean;
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
   * Also, false when upload hasn't started.
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

export enum HTTPResponses {
  NO_ERRORS = 201,
  EMPTY_FILE = 204,
  ERRORS_IN_FILE = 206,
  STORAGE_CONNECTION_FAILURE = 503,
  SQL_CONNECTION_TIMEOUT = 504,
}

export const tableHeaderSettings = {
  fontWeight: 'bold',
  fontSize: 16,
}

export interface DropzonePureProps {
  /** Is someone dragging file(s) onto the dropzone? */
  isDragActive: boolean;
  /** From react-dropzone, function which gets  for putting properties */
  getRootProps: any;
  /** From react-dropzone, function which gets properties for the input field. */
  getInputProps: any;
}

export interface RowDataStructure {
  tag: string,
  subquadrat: string,
  spcode: string,
  dbh: string,
  htmeas: string,
  codes: string,
  comments: string
}

export interface GridRowDataStructure {
  id: string,
  subquadrat: string,
  spcode: string,
  dbh: string,
  htmeas: string,
  codes: string,
  comments: string
}

export const gridColumns: GridColDef[] = [
  {field: 'id', headerName: 'Tag', headerClassName: 'header', width: 150},
  {field: 'subquadrat', headerName: 'Subquadrat', headerClassName: 'header', width: 150},
  {field: 'spcode', headerName: 'Species Code', headerClassName: 'header', width: 150},
  {field: 'dbh', headerName: 'DBH', headerClassName: 'header', width: 150},
  {field: 'htmeas', headerName: 'HTMEAS', headerClassName: 'header', width: 150},
  {field: 'codes', headerName: 'Codes', headerClassName: 'header', width: 150},
  {field: 'comments', headerName: 'Comments', headerClassName: 'header', width: 150},
];

// conditional CSS logic saved here for future usage
const columns: GridColDef[] = [
  {
    field: 'name',
    cellClassName: 'super-app-theme--cell',
  },
  {
    field: 'score',
    type: 'number',
    width: 140,
    cellClassName: (params: GridCellParams<any, number>) => {
      if (params.value == null) {
        return '';
      }
      
      return clsx('super-app', {
        negative: params.value < 0,
        positive: params.value > 0,
      });
    },
  },
];

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
  {key: 'user', label: 'Uploaded By'},
  {key: 'date', label: 'Date Entered'},
  {key: 'version', label: 'Version'},
  {key: 'isCurrentVersion', label: 'Is Current Version?'},
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

export const allCensusCount = 9;
export const allCensus = Array.from({length: allCensusCount}, (_, i) => i + 1)

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
  {key: 'tag', label: 'Tag'},
  {key: 'subquadrat', label: 'Subquadrat'},
  {key: 'spcode', label: 'SpCode'},
  {key: 'dbh', label: 'DBH'},
  {key: 'htmeas', label: 'Htmeas'},
  {key: 'codes', label: 'Codes'},
  {key: 'comments', label: 'Comments'},
]

export function updateOrInsertRDS(row: RowDataStructure, plot: string) {
  return `
      IF EXISTS (SELECT * FROM [plot_${plot.toLowerCase()}] WHERE Tag = ${parseInt(row.tag)})
        UPDATE [plot_${plot.toLowerCase()}]
        SET Subquadrat = ${parseInt(row.subquadrat)}, SpCode = ${parseInt(row.spcode)}, DBH = ${parseFloat(row.dbh)}, Htmeas = ${parseFloat(row.htmeas)}, Codes = '${row.codes}', Comments = '${row.comments}'
        WHERE Tag = ${parseInt(row.tag)};
      ELSE
        INSERT INTO [plot_${plot.toLowerCase()}] (Tag, Subquadrat, SpCode, DBH, Htmeas, Codes, Comments)
        VALUES (${parseInt(row.tag)}, ${parseInt(row.subquadrat)}, ${parseInt(row.spcode)}, ${parseFloat(row.dbh)}, ${parseFloat(row.htmeas)}, '${row.codes}', '${row.comments}');
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
  let containerClient = blobServiceClient.getContainerClient(plot.toLowerCase());
  await containerClient.createIfNotExists();
  return containerClient;
}

export async function uploadFileAsBuffer(containerClient: ContainerClient, file: File, user: string, errors: boolean) {
  const buffer = Buffer.from(await file.arrayBuffer());
  console.log(`blob name: ${file.name}`);
  let metadata = {
    user: user,
    errors: `${errors}`
  }
  // create connection & client facing new blob
  // async command to upload buffer via client, waiting for response
  return await containerClient.getBlockBlobClient(file.name).uploadData(buffer, {metadata})
}