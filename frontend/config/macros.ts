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
import {setData} from "@/config/db";
import {CensusRDS} from "@/config/sqlmacros";
import {CMIDRow, DetailedCMIDRow} from "@/components/uploadsystem/uploadparent";

// INTERFACES
export interface PlotRaw {
  key: string;
  num: number;
  id: number;
}

export type Plot = PlotRaw | null;

export interface QuadratRaw {
  quadratID: number;
  plotID: number;
  quadratName: string;
}

export type Quadrat = QuadratRaw | null;

export interface Census {
  plotID: number;
  plotCensusNumber: number;
  startDate: Date;
  endDate: Date;
  description: string;
}

export interface UploadedFileData {
  key: number;
  name: string;
  user: string;
  formType: string;
  fileErrors: any;
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
  "fixeddata_personnel": [{label: "firstname"}, {label: "lastname"}, {label: "role"}],
  "fixeddata_species": [{label: "spcode"}, {label: "genus"}, {label: "species"}, {label: "idlevel"}, {label: "family"}, {label: "authority"}],
  "fixeddata_quadrat": [{label: "quadrat"}, {label: "startx"}, {label: "starty"}, {label: "dimx"}, {label: "dimy"}],
  "fixeddata_census": [{label: "tag"}, {label: "stemtag"}, {label: "spcode"}, {label: "quadrat"}, {label: "lx"}, {label: "ly"}, {label: "dbh"}, {label: "codes"}, {label: "hom"}, {label: "date"}],
  "arcgis_xlsx": arcgisHeaders
};

export const RequiredTableHeadersByFormType: Record<string, { label: string }[]> = {
  "fixeddata_codes": [{label: "code"}, {label: "description"}, {label: "status"}],
  "fixeddata_personnel": [{label: "firstname"}, {label: "lastname"}],
  "fixeddata_species": [{label: "spcode"}, {label: "genus"}, {label: "species"}, {label: "idlevel"}],
  "fixeddata_quadrat": [{label: "quadrat"}, {label: "dimx"}, {label: "dimy"}],
  "fixeddata_census": [{label: "tag"}, {label: "stemtag"}, {label: "spcode"}, {label: "quadrat"}, {label: "lx"}, {label: "ly"}, {label: "dbh"}, {label: "codes"}, {label: "hom"}, {label: "date"}],
  "arcgis_xlsx": arcgisHeaders
}
export const DBInputForms: string[] = [
  "fixeddata_codes",
  "fixeddata_personnel",
  "fixeddata_species",
  "fixeddata_quadrat",
  "fixeddata_census"
];
export const FormGroups: Record<string, string[]> = {
  "Database Forms": DBInputForms,
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

export type FileRow = {
  [header: string]: string; // {header --> value}
};

export type FileRowSet = {
  [row: string]: FileRow; // {row --> FileRow}
};

export type FileCollectionRowSet = {
  [filename: string]: FileRowSet; // {filename --> FileRowSet}
};

export type ValidationErrorID = number;

export interface UploadStartProps {
  uploadForm: string;
  setUploadForm: Dispatch<SetStateAction<string>>;
  setExpectedHeaders: Dispatch<SetStateAction<string[]>>;
  setReviewState: Dispatch<SetStateAction<ReviewStates>>;
  personnelRecording: string;
  setPersonnelRecording: Dispatch<SetStateAction<string>>;
}

export interface UploadParseFilesProps {
  uploadForm: string;
  parsing: boolean;
  acceptedFiles: FileWithPath[];
  isOverwriteConfirmDialogOpen: boolean;
  setIsOverwriteConfirmDialogOpen: Dispatch<SetStateAction<boolean>>;
  personnelRecording: string;
  setPersonnelRecording: Dispatch<SetStateAction<string>>;
  setReviewState: Dispatch<SetStateAction<ReviewStates>>;
  handleInitialSubmit: () => Promise<void>;
  handleFileReplace: () => void;
  handleFileChange: (newFiles: FileWithPath[]) => void;
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
  parseAndUpdateFile: (file: FileWithPath) => Promise<void>;
}

export interface UploadFireProps extends UploadReviewFilesProps {
  personnelRecording: string;
  setIsDataUnsaved: React.Dispatch<React.SetStateAction<boolean>>;
  currentPlot: Plot;
  currentCensus: CensusRDS;
  user: string;
  uploadCompleteMessage: string;
  setUploadCompleteMessage: Dispatch<SetStateAction<string>>;
  handleReturnToStart: () => Promise<void>;
  allRowToCMID: DetailedCMIDRow[];
  setAllRowToCMID: Dispatch<SetStateAction<DetailedCMIDRow[]>>;
}

export interface UploadFireAzureProps extends UploadFireProps {
  cmErrors: CMError[];
  setCMErrors: Dispatch<SetStateAction<CMError[]>>;
}

export interface UploadValidationProps {
  setReviewState: React.Dispatch<React.SetStateAction<ReviewStates>>;
  currentPlot: Plot;
  currentCensus: CensusRDS;
}

export interface UploadValidationErrorDisplayProps {
  uploadForm: string;
  allRowToCMID: DetailedCMIDRow[]; // Updated to use DetailedCMIDRow[]
  setReviewState: Dispatch<SetStateAction<ReviewStates>>;
  cmErrors: CMError[];
  setCMErrors: Dispatch<SetStateAction<CMError[]>>;
}

export interface UploadUpdateValidationsProps {
  validationPassedCMIDs: number[];
  setValidationPassedCMIDs: Dispatch<SetStateAction<number[]>>;
  validationPassedRowCount: number;
  setValidationPassedRowCount: Dispatch<SetStateAction<number>>;
  currentPlot: Plot;
  currentCensus: CensusRDS;
  setReviewState: Dispatch<SetStateAction<ReviewStates>>;
  allRowToCMID: DetailedCMIDRow[];
  handleReturnToStart: () => Promise<void>;
}

export interface UploadCompleteProps {
  setIsUploadModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  uploadForm: string;
}

export interface ProgressStepperProps {
  progressTracker: ReviewProgress;
  setProgressTracker: Dispatch<SetStateAction<ReviewProgress>>;
  reviewState: ReviewStates;
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
  SQL_CONNECTION_FAILURE = 408, // Custom code, example
  STORAGE_CONNECTION_FAILURE = 507, // Custom code, example
  INVALID_REQUEST = 400, // Custom code, example
  ERRORS_IN_FILE = 422, // Custom code, example
  EMPTY_FILE = 204, // Custom code, example
}

export enum ReviewStates {
  START = "start",
  UPLOAD_FILES = "upload_files",
  REVIEW = "review",
  UPLOAD_SQL = "upload_sql",
  VALIDATE = "validate",
  VALIDATE_ERRORS_FOUND = "validate_errors_found",
  UPDATE = "update_rows",
  UPLOAD_AZURE = "upload_azure",
  COMPLETE = "complete",
  ERRORS = "errors",
  FILE_MISMATCH_ERROR = "file_mismatch_error",
}

export enum ReviewProgress {
  START = 1,
  UPLOAD_FILES = 2,
  REVIEW = 3,
  UPLOAD_SQL = 4,
  VALIDATE = 5,
  VALIDATE_ERRORS_FOUND = 6,
  UPDATE = 7,
  UPLOAD_AZURE = 8,
  COMPLETE = 9
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
  {key: 'formType', label: 'Form Type'},
  {key: 'fileErrors', label: 'Errors in File'},
  {key: 'date', label: 'Date Entered'},
  // {key: 'version', label: 'Version'},
  // {key: 'isCurrentVersion', label: 'Is Current Version?'},
]

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
  const storageAccountConnectionString = process.env.AZURE_STORAGE_CONNECTION_STRING!;
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

/**
 * CONTAINER STORAGE FUNCTIONS
 *
 * need a type to store validation errors by row per file
 * row per file can be stored as FileRowSet?
 */

const MAX_RETRIES = 3; // Maximum number of retries
const RETRY_DELAY_MS = 3000; // Delay between retries in milliseconds

export type FileRowErrors = {
  stemtag: string;
  tag: string;
  validationErrorID: number;
}

export async function uploadValidFileAsBuffer(containerClient: ContainerClient, file: File, user: string, formType: string, fileRowErrors: FileRowErrors[] = []) {
  const buffer = Buffer.from(await file.arrayBuffer());
  console.log(`Uploading blob: ${file.name}`);

  // Prepare metadata
  const metadata = {
    user: user,
    FormType: formType,
    FileErrorState: JSON.stringify(fileRowErrors.length > 0 ? fileRowErrors : [])
  };

  // Retry mechanism for the upload
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const uploadResponse = await containerClient.getBlockBlobClient(file.name).uploadData(buffer, { metadata });

      // If upload is successful, return the response
      if (uploadResponse) {
        console.log(`Upload successful on attempt ${attempt}: ${file.name}`);
        return uploadResponse;
      }
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        console.log(`Upload attempt ${attempt} failed for ${file.name}, retrying in ${RETRY_DELAY_MS}ms...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      } else {
        // If all attempts fail, rethrow the error
        console.error(`All upload attempts failed for ${file.name}`);
        throw error;
      }
    }
  }
}

// for validation error display ONLY
export interface CMError {
  CoreMeasurementID: number;
  ValidationErrorIDs: number[];
  Descriptions: string[];
}

export function formatDate(isoDateString: string): string {
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  };
  return new Date(isoDateString).toLocaleDateString(undefined, options);
}