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
import React, {Dispatch, SetStateAction} from "react";
import {CensusRDS} from "@/config/sqlmacros";
import {setData} from "@/config/db";

// INTERFACES
export interface Plot {
  key: string;
  num: number;
  id: number;
}

export interface Quadrat {
  quadratID: number;
  plotID: number;
  quadratName: string;
}

export interface PlotAction {
  plot: Plot | null;
}

export interface CensusRDSAction {
  census: CensusRDS | null;
}

export interface QuadratsAction {
  quadrat: Quadrat | null;
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

const arcgisHeaderString: string = "OBJECTID Q20 P5 Lx Ly Px Py SPP TAG STEMTAG DBH Viejo HOM Viejo Códigos Viejos Tallo Principal DBH HOM Tipo Arbol Estado Censo STEMTAG GlobalID Códigos D - Dead N - Tag and tree missing L - Leaning CYL - Trunk cylindrical for B trees R - Resprout B - Buttressed tree Q - Broken above 1.3 m M - Multiple-stemmed P - Problem A - Needs checking Ss - Dead stem still standing Cs - Dead stem fallen Ns - Stemtag and stem missing Ts - Stemtag found, stem missing Ascender DBH a 1.30 DOS - Dos placas EM - Error de medida ID - Problema identificación MED - Problema medida NC - No califica NUM - Número Equivocado PP - Placa Perdida Placa Repuesta POSIBLE - Placa/Planta dudosa VIVO - Posiblemente muerto MAP - Problema mapeo Problemas Comentarios Censado Por UTM X (m) UTM Y (m) Fecha Captura Mensaje DBH Equipo x y";

const arcgisHeaderArr: string[] = arcgisHeaderString.split(/\s+/);

interface HeaderObject {
  label: string;
}

const arcgisHeaders: HeaderObject[] = arcgisHeaderArr.map(header => ({
  label: header
}));

export const TableHeadersByFormType: Record<string, { label: string }[]> = {
  "fixeddata_codes": [{label: "code"}, {label: "description"}, {label: "status"}],
  // "fixeddata_role.csv": [{label: "role"}],
  "fixeddata_personnel": [{label: "firstname"}, {label: "lastname"}, {label: "role"}],
  "fixeddata_species": [{label: "spcode"}, {label: "genus"}, {label: "species"}, {label: "idlevel"}, {label: "family"}, {label: "authority"}],
  "fixeddata_quadrat": [{label: "quadrat"}, {label: "startx"}, {label: "starty"}, {label: "dimx"}, {label: "dimy"}],
  "fixeddata_census": [{label: "tag"}, {label: "stemtag"}, {label: "spcode"}, {label: "quadrat"}, {label: "lx"}, {label: "ly"}, {label: "dbh"}, {label: "codes"}, {label: "hom"}, {label: "date"}],
  "ctfsweb_new_plants_form": [{label: "quadrat"}, {label: "tag"}, {label: "stemtag"}, {label: "spcode"}, {label: "dbh"}, {label: "codes"}, {label: "comments"}],
  "ctfsweb_old_tree_form": [{label: "quadrat"}, {label: "tag"}, {label: "stemtag"}, {label: "spcode"}, {label: "olddbh"}, {label: "oldhom"}, {label: "dbh"}, {label: "codes"}, {label: "comments"}],
  "ctfsweb_multiple_stems_form": [{label: "quadrat"}, {label: "tag"}, {label: "stemtag"}, {label: "dbh"}, {label: "codes"}, {label: "comments"}],
  "ctfsweb_big_trees_form": [{label: "quadrat"}, {label: "subquadrat"}, {label: "tag"}, {label: "multistemtag"}, {label: "species"}, {label: "dbh"}, {label: "hom"}, {label: "comments"}],
  "arcgis_xlsx": arcgisHeaders
};

export const RequiredTableHeadersByFormType: Record<string, { label: string }[]> = {
  "fixeddata_codes": [{label: "code"}, {label: "description"}, {label: "status"}],
  // "fixeddata_role.csv": [{label: "role"}],
  "fixeddata_personnel": [{label: "firstname"}, {label: "lastname"}],
  "fixeddata_species": [{label: "spcode"}],
  "fixeddata_quadrat": [{label: "quadrat"}],
  "fixeddata_census": [{label: "tag"}, {label: "stemtag"}, {label: "spcode"}, {label: "quadrat"}, {label: "lx"}, {label: "ly"}, {label: "dbh"}, {label: "codes"}, {label: "hom"}, {label: "date"}],
  "ctfsweb_new_plants_form": [{label: "quadrat"}, {label: "tag"}, {label: "stemtag"}, {label: "spcode"}, {label: "dbh"}, {label: "codes"}],
  "ctfsweb_old_tree_form": [{label: "quadrat"}, {label: "tag"}, {label: "stemtag"}, {label: "spcode"}, {label: "olddbh"}, {label: "oldhom"}, {label: "dbh"}, {label: "codes"}],
  "ctfsweb_multiple_stems_form": [{label: "quadrat"}, {label: "tag"}, {label: "stemtag"}, {label: "dbh"}, {label: "codes"}],
  "ctfsweb_big_trees_form": [{label: "quadrat"}, {label: "subquadrat"}, {label: "tag"}, {label: "multistemtag"}, {label: "species"}, {label: "dbh"}, {label: "hom"}],
  "arcgis_xlsx": arcgisHeaders
}
export const DBInputForms: string[] = [
  "fixeddata_codes",
  "fixeddata_role",
  "fixeddata_personnel",
  "fixeddata_species",
  "fixeddata_quadrat",
  "fixeddata_census"
];
export const CTFSWebInputForms: string[] = [
  "ctfsweb_new_plants_form",
  "ctfsweb_old_tree_form",
  "ctfsweb_multiple_stems_form",
  "ctfsweb_big_trees_form",
];
export const FormGroups: Record<string, string[]> = {
  "Database Forms": DBInputForms,
  "CTFSWeb Forms": CTFSWebInputForms,
  "ArcGIS Forms": ["arcgis_xlsx"]
};

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

export interface ErrorRowsData {
  [fileName: string]: RowDataStructure[];
}

export interface AllRowsData {
  [fileName: string]: RowDataStructure[];
}

export type FileRow = {
  [header: string]: string; // {header --> value}
};

export type FileRowSet = {
  [row: string]: FileRow; // {row --> FileRow}
};

export type FileCollectionRowSet = {
  [filename: string]: FileRowSet; // {filename --> FileRowSet}
};

export interface UploadParseFilesProps {
  uploadForm: string;
  parsing: boolean;
  acceptedFiles: FileWithPath[];
  isOverwriteConfirmDialogOpen: boolean;
  setUploadForm: Dispatch<SetStateAction<string>>;
  setAcceptedFiles: Dispatch<SetStateAction<FileWithPath[]>>;
  setExpectedHeaders: Dispatch<SetStateAction<string[]>>;
  setIsOverwriteConfirmDialogOpen: Dispatch<SetStateAction<boolean>>;
  handleInitialSubmit: () => Promise<void>;
  handleFileReplace: () => void;
  handleFileChange: (newFiles: FileWithPath[]) => void;
  setUploadError: Dispatch<SetStateAction<any>>;
  setErrorComponent: Dispatch<SetStateAction<string>>;
}

export interface UploadReviewFilesProps {
  uploadForm: string;
  acceptedFiles: FileWithPath[];
  expectedHeaders: string[];
  parsedData: FileCollectionRowSet;
  errors: FileCollectionRowSet;
  errorRows: FileCollectionRowSet;
  confirmationDialogOpen: boolean;
  dataViewActive: number;
  currentFileHeaders: string[];
  setAcceptedFiles: Dispatch<SetStateAction<FileWithPath[]>>;
  setReviewState: Dispatch<SetStateAction<ReviewStates>>;
  setParsedData: Dispatch<SetStateAction<FileCollectionRowSet>>;
  setErrors: Dispatch<SetStateAction<FileCollectionRowSet>>;
  setErrorRows: Dispatch<SetStateAction<FileCollectionRowSet>>;
  setUploadError: Dispatch<SetStateAction<any>>;
  setErrorComponent: Dispatch<SetStateAction<string>>;
  handleChange: (_event: React.ChangeEvent<unknown>, value: number) => void;
  areHeadersValid: (actualHeaders: string[]) => boolean;
  handleRemoveCurrentFile: () => void;
  handleApproval: () => Promise<void>;
  handleCancel: () => Promise<void>;
  handleConfirm: () => Promise<void>;
}

export interface UploadFireProps extends UploadReviewFilesProps {
  setIsDataUnsaved: React.Dispatch<React.SetStateAction<boolean>>;
  currentPlot: Plot;
  currentCensus: CensusRDS;
  user: string;
  uploadCompleteMessage: string;
  setUploadCompleteMessage: Dispatch<SetStateAction<string>>;
  handleReturnToStart: () => Promise<void>;
  allRowToCMID: {fileName: string; coreMeasurementID: number; stemTag: string; treeTag: string;}[];
  allSetRowToCMID: Dispatch<SetStateAction<{fileName: string; coreMeasurementID: number; stemTag: string; treeTag: string;}[]>>;
}

export interface UploadErrorProps {
  error: any;
  component: string;
  acceptedFiles: FileWithPath[];
  setAcceptedFiles: Dispatch<SetStateAction<FileWithPath[]>>;
  setReviewState: Dispatch<SetStateAction<ReviewStates>>;
  handleReturnToStart: () => Promise<void>;
  resetError: () => Promise<void>;
}

export type FetchQueryFunction = (gridType: string, page: number, pageSize: number, plotID?: number) => string;
export type ProcessQueryFunction = (gridType: string, deletionID?: number) => string;

export enum HTTPResponses {
  OK = 200,
  CREATED = 201,
  ACCEPTED = 202,
  UNAUTHORIZED = 401,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  METHOD_NOT_ALLOWED = 405,
  CONFLICT = 409,
  INTERNAL_SERVER_ERROR = 500,
  NOT_IMPLEMENTED = 501,
  BAD_GATEWAY = 502,
  SERVICE_UNAVAILABLE = 503,
  GATEWAY_TIMEOUT = 504,
  // Add more as needed
  SQL_CONNECTION_FAILURE = 408, // Custom code, example
  STORAGE_CONNECTION_FAILURE = 507, // Custom code, example
  INVALID_REQUEST = 400, // Custom code, example
  ERRORS_IN_FILE = 422, // Custom code, example
  EMPTY_FILE = 204, // Custom code, example
}

export enum ReviewStates {
  PARSE = "parse",
  REVIEW = "review",
  UPLOAD = "upload",
  VALIDATE = "validate",
  UPDATE = "update_rows",
  COMPLETE = "complete",
  ERRORS = "errors",
  ERRORS_CORRECTION = "errors_correction",
  FILE_MISMATCH_ERROR = "file_mismatch_error"
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

export function bitToBoolean(bitField: any): boolean {
  if (Buffer.isBuffer(bitField)) {
    // If the BIT field is a Buffer, use the first byte for conversion
    return bitField[0] === 1;
  } else {
    // If it's not a Buffer, it might be a number or boolean
    return Boolean(bitField);
  }
}

export const booleanToBit = (value: boolean | undefined): number => value ? 1 : 0;

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
    expanded: [],
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
  {
    label: "Manual Input Forms (CTFSWeb)",
    href: "/forms",
    tip: 'forms from ctfsweb',
    icon: SettingsSuggestIcon,
    expanded: [
      {
        label: 'Census Form',
        href: '/census',
        tip: '',
        icon: DescriptionIcon,
      },
    ]
  },
]
// Define a type for the enhanced dispatch function
export type EnhancedDispatch<T> = (payload: { [key: string]: T | null }) => Promise<void>;

export function createEnhancedDispatch<T>(
  dispatch: Dispatch<LoadAction<T>>,
  actionType: string
): EnhancedDispatch<T> {
  return async (payload: { [key: string]: T | null }) => {
    // Save to IndexedDB only if payload is not null
    if (payload[actionType] !== null) {
      await setData(actionType, payload[actionType]);
      console.log(`setData call on key ${actionType} with value ${payload[actionType]} completed.`);
    }

    // Dispatch the action
    dispatch({type: actionType, payload});
    console.log(`Dispatch of type ${actionType} placed`);
  };
}

export type LoadAction<T> = {
  type: string;
  payload: { [key: string]: T | null };
};

// Generic reducer function
export function genericLoadReducer<T>(state: T | null, action: LoadAction<T>): T | null {
  console.log('Action:', action);
  switch (action.type) {
    case 'coreMeasurementLoad':
    case 'attributeLoad':
    case 'censusLoad':
    case 'personnelLoad':
    case 'quadratsLoad':
    case 'speciesLoad':
    case 'subSpeciesLoad':
    case 'plotsLoad':
    case 'plotList':
    case 'censusList':
    case 'quadratList':
      if (action.type !== null && action.payload && action.type in action.payload) {
        return action.payload[action.type] ?? state;
      } else {
        return state;
      }
    default:
      return state;
  }
}

export function genericLoadContextReducer<T>(
  currentState: T | null,
  action: LoadAction<T>,
  listContext: T[],
  validationFunction?: (list: T[], item: T) => boolean
): T | null {
  // Check if the action type is one of the specified types
  const isRecognizedActionType = ['plot', 'census', 'quadrat'].includes(action.type);
  if (!isRecognizedActionType) {
    return currentState;
  }

  // Check if payload exists and action type is valid key in payload
  if (!action.payload || !(action.type in action.payload)) {
    return currentState;
  }

  const item = action.payload[action.type];
  // Reset state to null if item is null
  if (item == null) return null;

  // Use validation function if provided and return current state if item is invalid
  if (validationFunction && !validationFunction(listContext, item)) {
    return currentState;
  }

  // Return the item if it's in the list context or no validation is needed
  return (!validationFunction || listContext.includes(item)) ? item : currentState;
}

/**
 * SQL function storage
 */
export async function getContainerClient(containerName: string) {
  const storageAccountConnectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  console.log('Connection String:', storageAccountConnectionString);
  console.log(`container name: ${containerName}`);
  if (!storageAccountConnectionString) {
    console.error("process envs failed");
    throw new Error("process envs failed");
  }
  // create client pointing to AZ storage system from connection string from Azure portal
  const blobServiceClient = BlobServiceClient.fromConnectionString(storageAccountConnectionString);
  if (!blobServiceClient) console.error("blob service client creation failed");
  else console.error("blob service client created & connected");
  // attempt connection to pre-existing container --> additional check to see if container was found
  let containerClient = blobServiceClient.getContainerClient(containerName);
  console.log(containerClient.url);
  if (!(await containerClient.createIfNotExists())) console.error("container client createifnotexists failure");
  else {
    console.log(`container client with name ${containerName} created and accessed.`);
    return containerClient;
  }
}

export type RowDataStructure = { [key: string]: any }; // Generic type for row data

/**
 * CONTAINER STORAGE FUNCTIONS
 */

export async function uploadFileAsBuffer(containerClient: ContainerClient, file: File, user: string, errors: boolean) {
  const buffer = Buffer.from(await file.arrayBuffer());
  console.log(buffer.toString());
  console.log(`blob name: ${file.name}`);
  let metadata = {
    user: user,
    errors: `${errors}`
  }
  // create connection & client facing new blob
  // async command to upload buffer via client, waiting for response
  return await containerClient.getBlockBlobClient(file.name).uploadData(buffer, {metadata})
}

export async function uploadValidFileAsBuffer(containerClient: ContainerClient, file: File, user: string) {
  const buffer = Buffer.from(await file.arrayBuffer());
  console.log(buffer.toString());
  console.log(`blob name: ${file.name}`);
  let metadata = {
    user: user,
  }
  // create connection & client facing new blob
  // async command to upload buffer via client, waiting for response
  return await containerClient.getBlockBlobClient(file.name).uploadData(buffer, {metadata})
}
