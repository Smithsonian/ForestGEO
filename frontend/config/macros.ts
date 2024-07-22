/**
 * Interface and type definitions for the ForestGEO upload system.
 *
 * This file defines types used throughout the upload system components to define props, state, contexts etc. It also defines some utility functions used in the upload flow.
 */
import {FileRejection, FileWithPath} from "react-dropzone";
import '@/styles/customtablesettings.css';
import {GridColDef, GridValidRowModel} from "@mui/x-data-grid";

export type ColumnStates = {
  [key: string]: boolean;
}


export type ValidationErrorID = number;

export enum HTTPResponses {
  OK = 200,
  CREATED = 201,
  CONFLICT = 409,
  INTERNAL_SERVER_ERROR = 500,
  SERVICE_UNAVAILABLE = 503,
  SQL_CONNECTION_FAILURE = 408, // Custom code, example
  INVALID_REQUEST = 400,
  PRECONDITION_VALIDATION_FAILURE = 412,
  FOREIGN_KEY_CONFLICT = 555,
  NOT_FOUND, // Custom code, example
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
};

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

export function formatDate(isoDateString: string): string {
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  };
  return new Date(isoDateString).toLocaleDateString(undefined, options);
}

export const unitSelectionOptions = ['km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm'];
export const areaSelectionOptions = ['km2', 'hm2', 'dam2', 'm2', 'dm2', 'cm2', 'mm2'];
export type ExtendedGridColDef<R extends GridValidRowModel = any, V = any, F = V> = GridColDef<R, V, F> & {
  required?: boolean;
};

export type UnifiedValidityFlags = {
  attributes: boolean;
  personnel: boolean;
  species: boolean;
  quadrats: boolean;
  quadratpersonnel: boolean;
}

export type GridSelections = {
  label: string; value: number;
}

export type UniqueKeys<T, U> = {
  [K in keyof (T & U)]: K extends keyof T ? (K extends keyof U ? never : K) : K;
}[keyof (T & U)];
export type Unique<T, U> = Pick<T & U, UniqueKeys<T, U>>;

export type CommonKeys<T, U> = {
  [K in keyof T & keyof U]: K;
}[keyof T & keyof U];

export type Common<T, U> = Pick<T & U, CommonKeys<T, U>>;