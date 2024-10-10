import { Dispatch, SetStateAction } from 'react';

const arcgisHeaderString: string =
  'OBJECTID Q20 P5 Lx Ly Px Py SPP TAG STEMTAG DBH Viejo HOM Viejo Códigos Viejos Tallo Principal DBH HOM Tipo Arbol Estado Censo STEMTAG GlobalID Códigos D - Dead N - Tag and tree missing L - Leaning CYL - Trunk cylindrical for B trees R - Resprout B - Buttressed tree Q - Broken above 1.3 m M - Multiple-stemmed P - Problem A - Needs checking Ss - Dead stem still standing Cs - Dead stem fallen Ns - Stemtag and stem missing Ts - Stemtag found, stem missing Ascender DBH a 1.30 DOS - Dos placas EM - Error de medida ID - Problema identificación MED - Problema medida NC - No califica NUM - Número Equivocado PP - Placa Perdida Placa Repuesta POSIBLE - Placa/Planta dudosa VIVO - Posiblemente muerto MAP - Problema mapeo Problemas Comentarios Censado Por UTM X (m) UTM Y (m) Fecha Captura Mensaje DBH Equipo x y';
const arcgisHeaderArr: string[] = arcgisHeaderString.split(/\s+/);

interface HeaderObject {
  label: string;
}

const arcgisHeaders: HeaderObject[] = arcgisHeaderArr.map(header => ({
  label: header
}));

export enum FormType {
  attributes = 'attributes',
  personnel = 'personnel',
  species = 'species',
  quadrats = 'quadrats',
  subquadrats = 'subquadrats',
  measurements = 'measurements',
  arcgis_xlsx = 'arcgis_xlsx'
}

// this does not include app users -- that is a different configuration. used solely to define users being submitted as part of census.
export const TableHeadersByFormType: Record<FormType, { label: string }[]> = {
  [FormType.attributes]: [{ label: 'code' }, { label: 'description' }, { label: 'status' }],
  [FormType.personnel]: [{ label: 'firstname' }, { label: 'lastname' }, { label: 'role' }, { label: 'roledescription' }],
  [FormType.species]: [
    { label: 'spcode' },
    { label: 'family' },
    { label: 'genus' },
    { label: 'species' },
    { label: 'subspecies' },
    { label: 'idlevel' },
    { label: 'authority' },
    { label: 'subspeciesauthority' }
  ],
  [FormType.quadrats]: [
    { label: 'quadrat' },
    { label: 'startx' },
    { label: 'starty' },
    { label: 'coordinateunit' },
    { label: 'dimx' },
    { label: 'dimy' },
    { label: 'dimensionunit' },
    { label: 'area' },
    { label: 'areaunit' },
    { label: 'quadratshape' }
  ],
  [FormType.subquadrats]: [
    { label: 'subquadrat' },
    { label: 'quadrat' },
    { label: 'dimx' },
    { label: 'dimy' },
    { label: 'dimensionunit' },
    { label: 'xindex' },
    { label: 'yindex' },
    { label: 'coordinateunit' },
    { label: 'orderindex' }
  ],
  [FormType.measurements]: [
    { label: 'tag' },
    { label: 'stemtag' },
    { label: 'spcode' },
    { label: 'quadrat' },
    { label: 'lx' },
    { label: 'ly' },
    { label: 'coordinateunit' },
    { label: 'dbh' },
    { label: 'dbhunit' },
    { label: 'hom' },
    { label: 'homunit' },
    { label: 'date' },
    { label: 'codes' }
  ],
  [FormType.arcgis_xlsx]: arcgisHeaders
};

export function getTableHeaders(formType: FormType, _usesSubquadrats: boolean): { label: string }[] {
  return TableHeadersByFormType[formType];
}

export const RequiredTableHeadersByFormType: Record<FormType, { label: string }[]> = {
  [FormType.attributes]: [],
  [FormType.personnel]: [],
  [FormType.species]: [],
  [FormType.quadrats]: [],
  [FormType.subquadrats]: [],
  [FormType.measurements]: [],
  [FormType.arcgis_xlsx]: []
};

export const DBInputForms: FormType[] = [
  FormType.attributes,
  FormType.personnel,
  FormType.species,
  FormType.quadrats,
  FormType.subquadrats,
  FormType.measurements
];

export const FormGroups: Record<string, string[]> = {
  'Database Forms': DBInputForms,
  'ArcGIS Forms': [FormType.arcgis_xlsx]
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
  dataViewActive: number;
  setDataViewActive: Dispatch<SetStateAction<number>>;
}

export interface FileErrors {
  [fileName: string]: { [currentRow: string]: string };
}

export type FileRow = {
  [header: string]: string | null; // {header --> value}
};

export type FileRowSet = {
  [row: string]: FileRow; // {row --> FileRow}
};

export type FileCollectionRowSet = {
  [filename: string]: FileRowSet; // {filename --> FileRowSet}
};

export interface UploadedFileData {
  key: number;
  name: string;
  user: string;
  formType?: string;
  fileErrors?: any;
  date?: Date;
}

export interface DataGridSignals {
  setChangesSubmitted: Dispatch<SetStateAction<boolean>>;
}

// CONSTANT MACROS

export const fileColumns = [
  { key: 'name', label: 'File Name' },
  { key: 'user', label: 'Uploaded By' },
  { key: 'formType', label: 'Form Type' },
  { key: 'fileErrors', label: 'Errors in File' },
  { key: 'date', label: 'Date Entered' }
  // {key: 'version', label: 'Version'},
  // {key: 'isCurrentVersion', label: 'Is Current Version?'},
];

export type RowValidationErrors = {
  [key: string]: string;
};

export type ValidationFunction = (row: FileRow) => RowValidationErrors | null;
