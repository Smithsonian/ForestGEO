import { Dispatch, SetStateAction } from 'react';
import { AttributeStatusOptions } from '@/config/sqlrdsdefinitions/core';
import { GridFilterItem, GridFilterModel } from '@mui/x-data-grid';
import { capitalizeAndTransformField } from '@/config/utils';
import { escape } from 'mysql2';

const arcgisHeaderString =
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
      category: 'optional'
    },
    {
      label: 'status',
      explanation: `Which of the following categories does your attribute fit into: ${AttributeStatusOptions.join(', ')}`, // this is converted to Chip
      // array via regex in rendering.
      category: 'optional'
    }
  ],
  [FormType.personnel]: [
    { label: 'firstname', category: 'required', explanation: "Personnel's provided first name" },
    { label: 'lastname', category: 'required', explanation: "Personnel's provided last name" },
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
    { label: 'family', explanation: 'The family taxon of your species', category: 'optional' },
    { label: 'genus', explanation: 'The genus taxon of your species', category: 'optional' },
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
    { label: 'quadratshape', explanation: 'The shape of the quadrat', category: 'optional' }
  ],
  [FormType.measurements]: [
    { label: 'tag', explanation: 'Tag number on the tree in the field, should be unique within each plot.', category: 'required' },
    {
      label: 'stemtag',
      explanation:
        'The stem tag used in the field to identify the diﬀerent stems of a tree in the case of multiple-stemmed trees. Most sites give the main stem a' +
        ' value of 0 and additional stems consecutive values 1,2 etc. Some sites have given multiple stems tags in the same series as trees.',
      category: 'optional'
    },
    { label: 'spcode', explanation: 'The species code for the tree', category: 'required' },
    {
      label: 'quadrat',
      explanation: 'The character name for the quadrat, usually the name used in the field; may be the row and column.',
      category: 'required'
    },
    { label: 'lx', explanation: 'The X-coordinate of the stem', category: 'required' },
    { label: 'ly', explanation: 'The Y-coordinate of the stem', category: 'required' },
    { label: 'dbh', explanation: 'The diameter at breast height (DBH) of the tree', category: 'optional' }, // optional -- dead stems should not be measured
    { label: 'hom', explanation: 'The height (from ground) where the measurement was taken', category: 'optional' }, // optional -- dead stems should not be measured
    { label: 'date', explanation: 'The date of the measurement', category: 'required' },
    { label: 'codes', explanation: 'The attribute codes associated with the measurement and stem', category: 'optional' }
  ],
  [FormType.arcgis_xlsx]: arcgisHeaders
};

export enum DatagridType {
  attributes = 'attributes',
  personnel = 'personnel',
  alltaxonomiesview = 'alltaxonomiesview',
  quadrats = 'quadrats',
  measurementssummaryview = 'measurementssummaryview',
  roles = 'roles',
  stemtaxonomiesview = 'stemtaxonomiesview',
  stem = 'stem',
  specieslimits = 'specieslimits',
  unifiedchangelog = 'unifiedchangelog',
  viewfulltable = 'viewfulltable'
}

export const QuadratHeaders = ['Quadrat Name', 'X (Starting)', 'Y (Starting)', 'Area', 'Dimension X', 'Dimension Y', 'Quadrat Shape'];

export const AttributeHeaders = ['Code', 'Description', 'Status'];

export const PersonnelHeaders = ['First Name', 'Last Name', 'Role', 'Role Description'];

export const AllTaxonomiesViewHeaders = [
  'Species Code',
  'Family',
  'Genus',
  'Genus Auth',
  'Species',
  'Subspecies',
  'Species ID Level',
  'Species Auth',
  'Subspecies Auth',
  'Field Family',
  'Valid Code',
  'Species Description',
  'Species Limits'
];

export const MeasurementSummaryViewHeaders = [
  'Quadrat Name',
  'Species Code',
  'Tree Tag',
  'Stem Tag',
  'X (Stem)',
  'Y (Stem)',
  'DBH (Diameter at Breast Height)',
  'HOM (Height of Measure)',
  'Description',
  'Attributes'
];

export const StemHeaders = ['Stem Tag', 'Local X', 'Local Y', 'Moved', 'Stem Description'];

export const SpeciesLimitsHeaders = ['LimitType', 'LowerBound', 'UpperBound'];

export const RolesHeaders = ['Role Name', 'Role Description'];

export const UnifiedChangelogHeaders = ['Table', 'Record', 'Operation', 'Old Row', 'New Row', 'Change Time', 'Changed By'];

export const ViewFullTableHeaders = [
  'Quadrat',
  'Species Code',
  'Tree',
  'Stem',
  'X (Stem)',
  'Y (Stem)',
  'DBH (Diameter at Breast Height)',
  'HOM (Height of Measure)',
  'Description',
  'Attributes',
  'Stem Tag',
  'Tree Tag',
  'Family',
  'Genus',
  'Species',
  'Subspecies',
  'Genus Authority',
  'Species Authority',
  'Subspecies Authority',
  'Species ID Level',
  'Species Field Family'
];

const DatagridToFormTypeMap: Record<DatagridType, FormType | undefined> = {
  [DatagridType.attributes]: FormType.attributes,
  [DatagridType.personnel]: FormType.personnel,
  [DatagridType.quadrats]: FormType.quadrats,
  [DatagridType.measurementssummaryview]: FormType.measurements,
  [DatagridType.alltaxonomiesview]: FormType.species,

  // these grid types don’t correspond to an upload form
  [DatagridType.roles]: undefined,
  [DatagridType.stem]: undefined,
  [DatagridType.stemtaxonomiesview]: undefined,
  [DatagridType.specieslimits]: undefined,
  [DatagridType.unifiedchangelog]: undefined,
  [DatagridType.viewfulltable]: undefined
};

const DatagridToFormHeaderMap: Record<DatagridType, Record<string, string>> = {
  [DatagridType.attributes]: {
    Code: 'code',
    Description: 'description',
    Status: 'status'
  },

  [DatagridType.personnel]: {
    'First Name': 'firstname',
    'Last Name': 'lastname',
    Role: 'role',
    'Role Description': 'roledescription'
  },

  [DatagridType.quadrats]: {
    'Quadrat Name': 'quadrat',
    'X (Starting)': 'startx',
    'Y (Starting)': 'starty',
    Area: 'area',
    'Dimension X': 'dimx',
    'Dimension Y': 'dimy',
    'Quadrat Shape': 'quadratshape'
  },

  [DatagridType.measurementssummaryview]: {
    'Quadrat Name': 'quadrat',
    'Species Code': 'spcode',
    'Tree Tag': 'tag',
    'Stem Tag': 'stemtag',
    'X (Stem)': 'lx',
    'Y (Stem)': 'ly',
    'DBH (Diameter at Breast Height)': 'dbh',
    'HOM (Height of Measure)': 'hom',
    Attributes: 'codes'
    // Note: “Description” in the summary view has no direct upload‐form equivalent.
  },

  [DatagridType.alltaxonomiesview]: {
    'Species Code': 'spcode',
    Family: 'family',
    Genus: 'genus',
    Species: 'species',
    Subspecies: 'subspecies',
    'Species ID Level': 'idlevel',
    'Species Auth': 'authority',
    'Subspecies Auth': 'subspeciesauthority'
    // Other taxonomy‐view columns (e.g. “Genus Auth”, “Field Family”, “Valid Code”, etc.)
    // don’t have matching upload‐form fields and are thus omitted.
  },

  // these grids have no associated upload form:
  [DatagridType.roles]: {},
  [DatagridType.stem]: {},
  [DatagridType.stemtaxonomiesview]: {},
  [DatagridType.specieslimits]: {},
  [DatagridType.unifiedchangelog]: {},
  [DatagridType.viewfulltable]: {}
};

export function getFormHeaderForGridHeader(
  grid: DatagridType,
  headerLabel: string
): { label: string; explanation?: string; category?: 'required' | 'optional' } | undefined {
  const formField = DatagridToFormHeaderMap[grid]?.[headerLabel];
  const formType = DatagridToFormTypeMap[grid];
  if (!formType || !formField) return undefined;
  return TableHeadersByFormType[formType].find(h => h.label === formField);
}

export function getFormForDataGrid(grid: DatagridType): FormType {
  return DatagridToFormTypeMap[grid] ?? FormType.arcgis_xlsx;
}

export function getDataGridForForm(form: FormType): DatagridType | undefined {
  return (Object.keys(DatagridToFormTypeMap) as DatagridType[]).find(grid => DatagridToFormTypeMap[grid] === form);
}

export const HeadersByDatagridType: Record<DatagridType, { label: string; explanation?: string; category?: 'required' | 'optional' }[]> = {
  [DatagridType.attributes]: TableHeadersByFormType[FormType.attributes].map(obj => ({
    label: obj.label.charAt(0).toUpperCase() + obj.label.substring(1),
    explanation: obj.explanation,
    category: obj.category
  })),
  [DatagridType.personnel]: PersonnelHeaders.map(header => ({
    label: header,
    explanation: {
      'First Name': "Personnel's first name",
      'Last Name': "Personnel's last name",
      Role: 'The name or title of the role.',
      'Role Description': 'A detailed description of the role and its responsibilities.'
    }[header],
    category: 'required'
  })),
  [DatagridType.alltaxonomiesview]: AllTaxonomiesViewHeaders.map(header => ({
    label: header,
    explanation:
      {
        'Species Code': 'A unique identifier code for the species.',
        Family: 'The family taxon for the species.',
        Genus: 'The genus taxon for the species.',
        'Genus Auth': 'The authority responsible for the classification of the genus.',
        Species: 'The specific epithet (species name) of the taxon.',
        Subspecies: 'The subspecies name, if applicable.',
        'Species ID Level': 'The taxonomic identification level of the species.',
        'Species Auth': 'The authority responsible for the species classification.',
        'Subspecies Auth': 'The authority responsible for the subspecies classification.',
        'Field Family': 'The family as identified in the field.',
        'Valid Code': 'Validation code for the species entry.',
        'Species Description': 'A detailed description of the species.',
        'Species Limits': 'The defined limits (e.g., DBH range) for the species.'
      }[header] || `Information related to ${header.toLowerCase()}.`,
    category: 'required'
  })),
  [DatagridType.quadrats]: QuadratHeaders.map(header => ({
    label: header,
    explanation: {
      'Quadrat Name': 'The name or identifier for the quadrat.',
      X: 'The starting X-coordinate of the quadrat.',
      Y: 'The starting Y-coordinate of the quadrat.',
      Area: 'The total area of the quadrat.',
      DimX: 'The dimension of the quadrat along the X-axis.',
      DimY: 'The dimension of the quadrat along the Y-axis.',
      'Quadrat Shape': 'The shape of the quadrat, e.g., square or rectangle.'
    }[header],
    category: 'required'
  })),
  [DatagridType.measurementssummaryview]: MeasurementSummaryViewHeaders.map(header => ({
    label: header,
    explanation: {
      'Quadrat Name': 'The name of the quadrat where measurements were taken.',
      'Species Code': 'The unique code for the species measured.',
      'Tree Tag': 'The tag or identifier for the tree measured.',
      'Stem Tag': 'The tag or identifier for the stem measured.',
      'X (Stem)': 'The local X-coordinate of the stem.',
      'Y (Stem)': 'The local Y-coordinate of the stem.',
      'DBH (Diameter at Breast Height)': 'The diameter at breast height of the tree.',
      'HOM (Height of Measure)': 'The height from the ground where DBH was measured.',
      Description: 'A text description of the measurement.',
      Attributes: 'Additional attributes associated with the measurement.'
    }[header],
    category: 'required'
  })),
  [DatagridType.roles]: RolesHeaders.map(header => ({
    label: header,
    explanation: {
      'Role Name': 'The name or title of the role.',
      'Role Description': 'A detailed description of the role and its responsibilities.'
    }[header],
    category: 'required'
  })),
  [DatagridType.stemtaxonomiesview]: StemHeaders.map(header => ({
    label: header,
    explanation: {
      'Stem Tag': 'A unique identifier for the stem in the field.',
      'Local X': 'The local X-coordinate of the stem.',
      'Local Y': 'The local Y-coordinate of the stem.',
      Moved: 'Indicates whether the stem has been moved.',
      'Stem Description': 'A description of the stem.'
    }[header],
    category: 'required'
  })),
  [DatagridType.stem]: StemHeaders.map(header => ({
    label: header,
    explanation: {
      'Stem Tag': 'A unique identifier for the stem in the field.',
      'Local X': 'The local X-coordinate of the stem.',
      'Local Y': 'The local Y-coordinate of the stem.',
      Moved: 'Indicates whether the stem has been moved.',
      'Stem Description': 'A description of the stem.'
    }[header],
    category: 'required'
  })),
  [DatagridType.specieslimits]: SpeciesLimitsHeaders.map(header => ({
    label: header,
    explanation: {
      LimitType: 'The type of limit applied (e.g., DBH or HOM).',
      LowerBound: 'The lower bound of the limit range.',
      UpperBound: 'The upper bound of the limit range.'
    }[header],
    category: 'required'
  })),
  [DatagridType.unifiedchangelog]: UnifiedChangelogHeaders.map(header => ({
    label: header,
    explanation: {
      Table: 'The name of the table where changes were made.',
      Record: 'The ID of the record that was changed.',
      Operation: 'The type of operation performed (e.g., insert, update, delete).',
      'Old Row': 'The state of the record before the change.',
      'New Row': 'The state of the record after the change.',
      'Change Time': 'The timestamp of when the change occurred.',
      'Changed By': 'The user who performed the change.'
    }[header],
    category: 'required'
  })),
  [DatagridType.viewfulltable]: ViewFullTableHeaders.map(header => ({
    label: header,
    explanation:
      {
        Quadrat: 'The name of the quadrat where the data is located.',
        'Species Code': 'The unique code for the species.',
        Tree: 'The tag or identifier for the tree.',
        Stem: 'The tag or identifier for the stem.',
        X: 'The local X-coordinate of the stem.',
        Y: 'The local Y-coordinate of the stem.',
        DBH: 'The diameter at breast height of the tree.',
        HOM: 'The height from the ground where DBH was measured.',
        Description: 'A text description of the measurement.',
        Attributes: 'Additional attributes associated with the measurement.',
        'Stem Tag': 'A unique identifier for the stem in the field.',
        'Tree Tag': 'A unique identifier for the tree in the field.',
        Family: 'The family taxon for the species.',
        Genus: 'The genus taxon for the species.',
        Species: 'The specific epithet (species name) of the taxon.',
        Subspecies: 'The subspecies name, if applicable.',
        'Genus Authority': 'The authority responsible for the classification of the genus.',
        'Species Authority': 'The authority responsible for the species classification.',
        'Subspecies Authority': 'The authority responsible for the subspecies classification.',
        'Species ID Level': 'The taxonomic identification level of the species.',
        'Species Field Family': 'The family as identified in the field.'
      }[header] || `Combined view field: ${header.toLowerCase()}.`,
    category: 'required'
  }))
};

export function getTableHeaders(formType: FormType, _usesSubquadrats = false): { label: string }[] {
  return TableHeadersByFormType[formType];
}

export function getGridHeaders(gridType: DatagridType): { label: string; explanation?: string; category?: 'required' | 'optional' }[] {
  return HeadersByDatagridType[gridType];
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

export type FileErrors = Record<string, Record<string, string>>;

export type FileRow = Record<string, string | null>;

export type FileRowSet = Record<string, FileRow>;

export type FileCollectionRowSet = Record<string, FileRowSet>;

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

export type RowValidationErrors = Record<string, string>;

export type ValidationFunction = (row: FileRow) => RowValidationErrors | null;

export type Operator = 'contains' | 'doesNotContain' | 'equals' | 'doesNotEqual' | 'startsWith' | 'endsWith' | 'isEmpty' | 'isNotEmpty' | 'isAnyOf';

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

export function buildCondition({ operator, column, value }: { operator: Operator; column: string; value?: string | string[] }): string {
  switch (operator) {
    case 'contains':
      // Use the value as provided since it already includes the % signs
      return `${column} LIKE '%${escapeSql(value as string)}%'`;
    case 'doesNotContain':
      return `${column} NOT LIKE '%${escapeSql(value as string)}%'`;
    case 'equals':
      return `${column} = '${escapeSql(value as string)}'`;
    case 'doesNotEqual':
      return `${column} <> '${escapeSql(value as string)}'`;
    case 'startsWith':
      return `${column} LIKE CONCAT('${escapeSql(value as string)}', '%')`;
    case 'endsWith':
      return `${column} LIKE CONCAT('%', '${escapeSql(value as string)}')`;
    case 'isEmpty':
      return `(${column} = '' OR ${column} IS NULL)`;
    case 'isNotEmpty':
      return `(${column} <> '' AND ${column} IS NOT NULL)`;
    case 'isAnyOf':
      if (Array.isArray(value)) {
        const values = value.map(val => `'${escapeSql(val)}'`).join(', ');
        return `${column} IN (${values})`;
      }
      throw new Error('For "is any of", value must be an array.');
    default:
      throw new Error('Unsupported operator');
  }
}

export const buildFilterModelStub = (filterModel: GridFilterModel, alias?: string) => {
  if (!filterModel.items || filterModel.items.length === 0) {
    return '';
  }

  return filterModel.items
    .map((item: GridFilterItem) => {
      const { field, operator, value } = item;
      if (!field || !operator || !value) return '';
      const aliasedField = `${alias ? `${alias}.` : ''}${capitalizeAndTransformField(field)}`;
      const condition = buildCondition({ operator: operator as Operator, column: aliasedField, value });
      console.log('generated condition: ', condition);
      return condition;
    })
    .join(` ${filterModel?.logicOperator?.toUpperCase() || 'AND'} `);
};

export const buildSearchStub = (columns: string[], quickFilter: string[], alias?: string) => {
  if (!quickFilter || quickFilter.length === 0) {
    return ''; // Return empty if no quick filters
  }

  return columns
    .map(column => {
      const aliasedColumn = `${alias ? `${alias}.` : ''}${column}`;
      return quickFilter.map(word => `${aliasedColumn} LIKE ${escape(`%${word}%`)}`).join(' OR ');
    })
    .join(' OR ');
};