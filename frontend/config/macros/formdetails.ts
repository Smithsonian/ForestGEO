import { Dispatch, SetStateAction } from 'react';
import { AttributeStatusOptions } from '@/config/sqlrdsdefinitions/core';

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
  measurements = 'measurements',
  arcgis_xlsx = 'arcgis_xlsx'
}

// this does not include app users -- that is a different configuration. used solely to define users being submitted as part of census.
export const TableHeadersByFormType: Record<FormType, { label: string; explanation?: string; category?: 'required' | 'optional' }[]> = {
  [FormType.attributes]: [
    {
      label: 'code',
      explanation: 'A representative string composed of 10 or less characters that describes your attribute',
      category: 'required'
    },
    {
      label: 'description',
      explanation: 'Describe your attribute. Use as much detail as possible so that your attribute is easily understood by others.',
      category: 'required'
    },
    {
      label: 'status',
      explanation: `Which of the following categories does your attribute fit into: ${AttributeStatusOptions.join(', ')}`,
      category: 'required'
    }
  ],
  [FormType.personnel]: [
    { label: 'firstname', category: 'required' },
    { label: 'lastname', category: 'required' },
    {
      label: 'role',
      explanation: 'Characterize the job assigned to this person',
      category: 'required'
    },
    { label: 'roledescription', explanation: 'Describe the job in more detail', category: 'optional' }
  ],
  [FormType.species]: [
    {
      label: 'spcode',
      explanation: 'An identifying code composed of 25 or less characters. This code should be unique to your species.',
      category: 'required'
    },
    { label: 'family', explanation: 'The family taxon of your species', category: 'required' },
    { label: 'genus', explanation: 'The genus taxon of your species', category: 'required' },
    { label: 'species', explanation: 'The name of your species', category: 'required' },
    { label: 'subspecies', explanation: 'The subspecies taxon of your species', category: 'optional' },
    {
      label: 'idlevel',
      explanation:
        'The deepest taxonomic level for which full identification is known. Limited to values species, genus, family, none, or multiple. ' +
        'None is used when family is not known. Multiple is used when the name may include mixture of more than one species.',
      category: 'optional'
    },
    { label: 'authority', explanation: 'Taxonomic authority for the classification of the species', category: 'optional' },
    { label: 'subspeciesauthority', explanation: 'Taxonomic authority for the classification of the subspecies.', category: 'optional' }
  ],
  [FormType.quadrats]: [
    {
      label: 'quadrat',
      explanation: 'The character name for the quadrat, usually the name used in the field; may be the row and column. eg.: ' + '"0322"',
      category: 'required'
    },
    { label: 'startx', explanation: 'X-coordinate describing the starting point (lower left corner) of the quadrat', category: 'required' },
    { label: 'starty', explanation: 'Y-coordinate describing the starting point (lower left corner) of the quadrat', category: 'required' },
    { label: 'dimx', explanation: 'The dimension of the quadrat in the X-direction', category: 'required' },
    { label: 'dimy', explanation: 'The dimension of the quadrat in the Y-direction', category: 'required' },
    { label: 'area', explanation: 'The area of the quadrat', category: 'required' },
    { label: 'quadratshape', explanation: 'The shape of the quadrat', category: 'required' }
  ],
  [FormType.measurements]: [
    { label: 'tag', explanation: 'Tag number on the tree in the field, should be unique within each plot.', category: 'required' },
    {
      label: 'stemtag',
      explanation:
        'The stem tag used in the field to identify the diﬀerent stems of a tree in the case of multiple-stemmed trees. Most sites give the main stem a' +
        ' value of 0 and additional stems consecutive values 1,2 etc. Some sites have given multiple stems tags in the same series as trees.',
      category: 'required'
    },
    { label: 'spcode', explanation: 'The species code for the tree', category: 'required' },
    {
      label: 'quadrat',
      explanation: 'The character name for the quadrat, usually the name used in the field; may be the row and column.',
      category: 'required'
    },
    { label: 'lx', explanation: 'The X-coordinate of the stem', category: 'required' },
    { label: 'ly', explanation: 'The Y-coordinate of the stem', category: 'required' },
    { label: 'dbh', explanation: 'The diameter at breast height (DBH) of the tree', category: 'required' },
    { label: 'hom', explanation: 'The height (from ground) where the measurement was taken', category: 'required' },
    { label: 'date', explanation: 'The date of the measurement', category: 'required' },
    { label: 'codes', explanation: 'The attribute codes associated with the measurement and stem', category: 'required' }
  ],
  [FormType.arcgis_xlsx]: arcgisHeaders
};

export function getTableHeaders(formType: FormType, _usesSubquadrats = false): { label: string }[] {
  return TableHeadersByFormType[formType];
}

export const RequiredTableHeadersByFormType: Record<FormType, { label: string }[]> = {
  [FormType.attributes]: TableHeadersByFormType[FormType.attributes].filter(header => header.category === 'required'),
  [FormType.personnel]: TableHeadersByFormType[FormType.personnel].filter(header => header.category === 'required'),
  [FormType.species]: TableHeadersByFormType[FormType.species].filter(header => header.category === 'required'),
  [FormType.quadrats]: TableHeadersByFormType[FormType.quadrats].filter(header => header.category === 'required'),
  [FormType.measurements]: TableHeadersByFormType[FormType.measurements].filter(header => header.category === 'required'),
  [FormType.arcgis_xlsx]: []
};

export const DBInputForms: FormType[] = [FormType.attributes, FormType.personnel, FormType.species, FormType.quadrats, FormType.measurements];

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
