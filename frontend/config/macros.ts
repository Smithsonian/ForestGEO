import {BlobServiceClient, ContainerClient} from "@azure/storage-blob";
import {FileRejection, FileWithPath} from "react-dropzone";
import '@/styles/customtablesettings.css'
import DashboardIcon from '@mui/icons-material/Dashboard';
import FolderIcon from '@mui/icons-material/Folder';
import DataObjectIcon from '@mui/icons-material/DataObject';
import SettingsSuggestIcon from '@mui/icons-material/SettingsSuggest';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import DescriptionIcon from '@mui/icons-material/Description';
import GridOnIcon from '@mui/icons-material/GridOn';
import WidgetsIcon from '@mui/icons-material/Widgets';
import BugReportIcon from '@mui/icons-material/BugReport';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAlt';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import React from "react";

// INTERFACES
export interface Plot {
  key: string;
  num: number;
  id: number;
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
  TABLE_SELECT = "table_select",
  PARSE = "parse",
  REVIEW = "review",
  UPLOAD = "upload",
  UPLOADED = "uploaded",
  ERRORS = "errors"
}

export enum ErrorMessages {
  SCF = "SQL Command Failure",
  ICF = "Insertion Command Failed",
  UCF = "Update Command Failed",
  DCF = "Delete Command Failed",
  UKAE = "Unique Key Already Exists",
}

export const tableHeaderSettings = {
  fontWeight: 'bold',
  fontSize: 16,
}

export interface DropzonePureProps {
  /** Is someone dragging file(s) onto the dropzone? */
  isDragActive: boolean;
  /** From react-dropzone, function which gets  for putting attributes */
  getRootProps: any;
  /** From react-dropzone, function which gets attributes for the input field. */
  getInputProps: any;
}

// conditional CSS logic saved here for future usage
// const columns: GridColDef[] = [
//   {
//     field: 'name',
//     cellClassName: 'super-app-theme--cell',
//   },
//   {
//     field: 'score',
//     type: 'number',
//     width: 140,
//     cellClassName: (params: GridCellParams<any, number>) => {
//       if (params.value == null) {
//         return '';
//       }
//
//       return clsx('super-app', {
//         negative: params.value < 0,
//         positive: params.value > 0,
//       });
//     },
//   },
// ];

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
  {key: "Amacayacu", num: 16, id: 0},
  {key: "BCI", num: 40, id: 0},
  {key: "bukittimah", num: 22, id: 0},
  {key: "Cocoli", num: 39, id: 0},
  {key: "CRC", num: 1, id: 0},
  {key: "CTFS-Panama", num: 11, id: 0},
  {key: "Danum", num: 36, id: 0},
  {key: "Harvard Forest", num: 9, id: 0},
  {key: "Heishiding", num: 4, id: 0},
  {key: "HKK", num: 19, id: 0},
  {key: "ituri_all", num: 24, id: 0},
  {key: "khaochong", num: 38, id: 0},
  {key: "Korup", num: 10, id: 0},
  {key: "korup3census", num: 32, id: 0},
  {key: "Lambir", num: 35, id: 0},
  {key: "Lilly_Dickey", num: 41, id: 0},
  {key: "Luquillo", num: 25, id: 0},
  {key: "Mpala", num: 3, id: 0},
  {key: "osfdp", num: 37, id: 0},
  {key: "pasoh", num: 15, id: 0},
  {key: "Rabi", num: 17, id: 0},
  {key: "Scotty Creek", num: 8, id: 0},
  {key: "SERC", num: 7, id: 0},
  {key: "Sinharaja", num: 26, id: 0},
  {key: "Speulderbos", num: 29, id: 0},
  {key: "Stable_bukittimah", num: 27, id: 0},
  {key: "stable_pasoh", num: 28, id: 0},
  {key: "Traunstein", num: 34, id: 0},
  {key: "Tyson", num: 23, id: 0},
  {key: "UMBC", num: 18, id: 0},
  {key: "Utah", num: 30, id: 0},
  {key: "Vandermeer", num: 14, id: 0},
  {key: "wanang", num: 21, id: 0},
  {key: "Yosemite", num: 33, id: 0},
];

export const allCensusCount = 9;
export const allCensus = Array.from({length: allCensusCount}, (_, i) => i + 1);

export const allQuadratCount = 10;
export const allQuadrats = Array.from({length: allQuadratCount}, (_, i) => i + 1);
export type SiteConfigProps = {
  label: string;
  href: string;
  tip: string;
  icon: React.ElementType;
  expanded: {
    label: string;
    href: string;
    tip: string;
    icon: React.ElementType;
  }[];
}

export const siteConfig = {
  name: "ForestGEO",
  description: "Census data entry and storage",
};

export const siteConfigNav: SiteConfigProps[] = [
  {
    label: 'Dashboard',
    href: '/dashboard',
    tip: 'Home Page',
    icon: DashboardIcon,
    expanded: [],
  },
  {
    label: "File Upload Hub",
    href: "/fileuploadhub",
    tip: 'Upload data',
    icon: FolderIcon,
    expanded: [
      {
        label: 'ArcGIS File Upload',
        href: '/arcgisfile',
        tip: 'Upload an ArcGIS File',
        icon: SatelliteAltIcon,
      },
      {
        label: 'CSV File Upload',
        href: '/csvfile',
        tip: 'Upload a CSV file',
        icon: UploadFileIcon,
      }
    ],
  },
  {
    label: "Core Measurements Hub",
    href: "/coremeasurementshub",
    tip: 'View existing core measurement data for a given plot, census, and quadrat',
    icon: DataObjectIcon,
    expanded: [],
  },
  {
    label: "Measurement Properties Hub",
    href: "/properties",
    tip: 'View Modifiable Properties',
    icon: SettingsSuggestIcon,
    expanded: [
      {
        label: 'Attributes',
        href: '/attributes',
        tip: '',
        icon: DescriptionIcon,
      },
      {
        label: 'Census',
        href: '/census',
        tip: '',
        icon: GridOnIcon,
      },
      {
        label: 'Personnel',
        href: '/personnel',
        tip: '',
        icon: AccountCircleIcon,
      },
      {
        label: 'Quadrats',
        href: '/quadrats',
        tip: '',
        icon: WidgetsIcon,
      },
      {
        label: 'Species',
        href: '/species',
        tip: '',
        icon: BugReportIcon,
      }
    ]
  },
]

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

// export function updateOrInsertRDS(row: RowDataStructure, plot: string) {
//   return `
//       IF EXISTS (SELECT * FROM [plot_${plot.toLowerCase()}] WHERE Tag = ${parseInt(row.tag)})
//         UPDATE [plot_${plot.toLowerCase()}]
//         SET Subquadrat = ${parseInt(row.subquadrat)}, SpCode = ${parseInt(row.spcode)}, DBH = ${parseFloat(row.dbh)}, Htmeas = ${parseFloat(row.htmeas)}, Codes = '${row.codes}', Comments = '${row.comments}'
//         WHERE Tag = ${parseInt(row.tag)};
//       ELSE
//         INSERT INTO [plot_${plot.toLowerCase()}] (Tag, Subquadrat, SpCode, DBH, Htmeas, Codes, Comments)
//         VALUES (${parseInt(row.tag)}, ${parseInt(row.subquadrat)}, ${parseInt(row.spcode)}, ${parseFloat(row.dbh)}, ${parseFloat(row.htmeas)}, '${row.codes}', '${row.comments}');
//     `;
// }

export function selectAllRows(plot: string) {
  return `SELECT *
          FROM [plot_${plot.toLowerCase()}]`;
}

/**
 * CONTAINER STORAGE FUNCTIONS
 */
export async function getContainerClient(plot: string) {
  const storageAccountConnectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!storageAccountConnectionString) throw new Error("process envs failed");
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