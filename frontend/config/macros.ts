/**
 * Interface and type definitions for the ForestGEO upload system.
 *
 * This file defines types used throughout the upload system components to define props, state, contexts etc. It also defines some utility functions used in the upload flow.
 */
import { FileRejection, FileWithPath } from 'react-dropzone';
import '@/styles/customtablesettings.css';
import ConnectionManager from '@/config/connectionmanager';
import { FileRow, FileRowSet } from '@/config/macros/formdetails';
import { processPersonnel } from '@/components/processors/processpersonnel';
import { processSpecies } from '@/components/processors/processspecies';
import { processCensus } from '@/components/processors/processcensus';
import { processBulkIngestion } from '@/components/processors/processbulkingestion';
import { Plot } from '@/config/sqlrdsdefinitions/zones';
import { OrgCensus } from '@/config/sqlrdsdefinitions/timekeeping';

export type ColumnStates = Record<string, boolean>;

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
  NOT_FOUND // Custom code, example
}

export enum ErrorMessages {
  SCF = 'SQL Command Failure',
  ICF = 'Insertion Command Failed',
  UCF = 'Update Command Failed',
  DCF = 'Delete Command Failed',
  UKAE = 'Unique Key Already Exists'
}

export const tableHeaderSettings = {
  fontWeight: 'bold',
  fontSize: 16
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
    // Ensure non-zero bytes are considered `true`
    return bitField[0] !== 0;
  } else if (bitField instanceof Uint8Array) {
    return bitField[0] !== 0;
  } else {
    return Boolean(bitField);
  }
}

export const booleanToBit = (value: boolean | undefined): number => (value ? 1 : 0);

export const unitSelectionOptions = ['km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm'];
export const areaSelectionOptions = ['km2', 'hm2', 'dam2', 'm2', 'dm2', 'cm2', 'mm2'];

export interface UnifiedValidityFlags {
  attributes: boolean;
  personnel: boolean;
  species: boolean;
  quadrats: boolean;
}

export interface GridSelections {
  label: string;
  value: number;
}

export type UserAuthRoles = 'global' | 'db admin' | 'lead technician' | 'field crew';

export interface SpecialProcessingProps {
  connectionManager: ConnectionManager;
  rowData: FileRow;
  schema: string;
  plot?: Plot;
  census?: OrgCensus;
  quadratID?: number;
  fullName?: string;
}

export interface SpecialBulkProcessingProps {
  connectionManager: ConnectionManager;
  rowDataSet: FileRowSet;
  schema: string;
  plot?: Plot;
  census?: OrgCensus;
  quadratID?: number;
  fullName?: string;
}

export interface InsertUpdateProcessingProps extends SpecialProcessingProps {
  formType: string;
}

export interface FileMapping {
  tableName: string;
  columnMappings: Record<string, string>;
  specialProcessing?: (props: Readonly<SpecialProcessingProps>) => Promise<void>;
  bulkProcessing?: (props: Readonly<SpecialBulkProcessingProps>) => Promise<void>;
}

// Define the mappings for each file type
export const fileMappings: Record<string, FileMapping> = {
  attributes: {
    tableName: 'Attributes',
    columnMappings: {
      code: 'Code',
      description: 'Description',
      status: 'Status'
    }
  },
  personnel: {
    tableName: 'Personnel',
    columnMappings: {
      firstname: 'FirstName',
      lastname: 'LastName',
      role: 'Role',
      roledescription: 'Role Description'
    },
    specialProcessing: processPersonnel
  },
  species: {
    tableName: '',
    columnMappings: {
      spcode: 'Species.SpeciesCode',
      family: 'Family.Family',
      genus: 'Genus.GenusName',
      species: 'Species.SpeciesName',
      subspecies: 'Species.SubspeciesName', // optional
      idlevel: 'Species.IDLevel',
      authority: 'Species.Authority',
      subauthority: 'Species.SubspeciesAuthority' // optional
    },
    specialProcessing: processSpecies
  },
  quadrats: {
    tableName: 'quadrats',
    // "quadrats": [{label: "quadrat"}, {label: "startx"}, {label: "starty"}, {label: "dimx"}, {label: "dimy"}, {label: "unit"}, {label: "quadratshape"}],
    columnMappings: {
      quadrat: 'QuadratName',
      plotID: 'PlotID',
      startx: 'StartX',
      starty: 'StartY',
      dimx: 'DimensionX',
      dimy: 'DimensionY',
      dimensionunit: 'DimensionUnits',
      quadratshape: 'QuadratShape'
    }
  },
  measurements: {
    tableName: '', // Multiple tables involved
    columnMappings: {},
    specialProcessing: processCensus,
    bulkProcessing: processBulkIngestion
  }
};

export interface ValidationResponse {
  totalRows: number;
  failedRows: number;
  message: string;
  failedCoreMeasurementIDs?: number[];
}

export const HEADER_ALIGN = 'center';
export const CELL_ALIGN = 'center';
