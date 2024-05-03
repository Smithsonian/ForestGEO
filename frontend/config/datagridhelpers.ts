/**
 * Defines templates for new rows in data grids
 */
// datagridhelpers.ts
import { GridRowModel, GridToolbarProps, GridValidRowModel } from '@mui/x-data-grid';
import { coreMeasurementsFields } from './sqlrdsdefinitions/tables/coremeasurementsrds';
import { attributesFields } from './sqlrdsdefinitions/tables/attributerds';
import { censusFields } from './sqlrdsdefinitions/tables/censusrds';
import { personnelFields } from './sqlrdsdefinitions/tables/personnelrds';
import { quadratsFields } from './sqlrdsdefinitions/tables/quadratrds';
import { speciesFields } from './sqlrdsdefinitions/tables/speciesrds';
import { subquadratsFields } from './sqlrdsdefinitions/tables/subquadratrds';
import { allTaxonomiesFields, stemDimensionsViewFields, stemTaxonomiesViewFields } from '@/components/processors/processorhelperfunctions';

export interface FieldTemplate {
  type: 'string' | 'number' | 'boolean' | 'array' | 'date' | 'unknown'
  initialValue?: string | number | boolean | any[] | null
}

export interface Templates {
  [gridType: string]: {
    [fieldName: string]: FieldTemplate
  }
}
function getType(value: any): FieldTemplate['type'] {
  if (typeof value === 'number') {
    return 'number';
  } else if (typeof value === 'string') {
    return 'string';
  } else if (typeof value === 'boolean') {
    return 'boolean';
  } else if (value instanceof Date) {
    return 'date';
  } else if (Array.isArray(value)) {
    return 'array';
  } else {
    return 'unknown';
  }
}

export function validateRowStructure(
  gridType: string,
  oldRow: GridRowModel
): boolean {
  const template = newRowTemplates[gridType];
  if (!template) {
    throw new Error('Invalid grid type submitted');
  }

  const currentDate = new Date();

  return Object.keys(template).every(key => {
    const expected = template[key];
    const value = oldRow[key];

    if (!(key in oldRow) || getType(value) !== expected.type) {
      return false;
    }

    if (expected.type === 'date' && value instanceof Date) {
      return value.toDateString() === currentDate.toDateString();
    }

    if ('initialValue' in expected && expected.initialValue !== null) {
      return value === expected.initialValue;
    }

    return true;
  });
}

export type FetchQueryFunction = (
  siteSchema: string,
  gridType: string,
  page: number,
  pageSize: number,
  plotID?: number,
  quadratID?: number
) => string
export type ProcessQueryFunction = (
  siteSchema: string,
  gridType: string,
  deletionID?: number | string
) => string

export interface EditToolbarProps extends GridToolbarProps {
  locked?: boolean
  handleAddNewRow: () => void
  handleRefresh: () => Promise<void>
}

export const createProcessQuery: ProcessQueryFunction = (
  siteSchema: string,
  gridType: string
) => {
  let baseQuery = `/api/`;
  switch (gridType) {
    case 'stemDimensions':
    case 'stemTaxonomies':
    case 'allTaxonomies':
    case 'coreMeasurements':
    case 'census':
    case 'quadrats':
    case 'subquadrats':
    case 'attributes':
    case 'personnel':
    case 'species':
      baseQuery += `fixeddata/${gridType.toLowerCase()}?schema=${siteSchema}`;
      break;
    default:
      throw new Error('invalid gridtype selected');
  }
  return baseQuery;
};
export const createFetchQuery: FetchQueryFunction = (
  siteSchema: string,
  gridType,
  page,
  pageSize,
  plotID,
  quadratID?: number
) => {
  let baseQuery = `/api/`;
  switch (gridType) {
    case 'coreMeasurements':
    case 'census':
    case 'quadrats':
    case 'measurementsSummary':
      baseQuery += `fixeddata/${gridType.toLowerCase()}?schema=${siteSchema}&page=${page}&pageSize=${pageSize}`;
      baseQuery += plotID ? `&plotID=${plotID}` : ``;
      break;
    case 'subquadrats':
      baseQuery += `fixeddata/${gridType.toLowerCase()}?schema=${siteSchema}&page=${page}&pageSize=${pageSize}`;
      baseQuery += plotID ? `&plotID=${plotID}` : ``;
      baseQuery += quadratID ? `&quadratID=${quadratID}` : ``;
      break;
    case 'attributes':
    case 'personnel':
    case 'species':
    case 'stemDimensions':
      baseQuery += `fixeddata/${gridType.toLowerCase()}?schema=${siteSchema}&page=${page}&pageSize=${pageSize}`;
      break;
    default:
      throw new Error('invalid gridtype selected');
  }
  return baseQuery;
};

export const createDeleteQuery: ProcessQueryFunction = (
  siteSchema: string,
  gridType: string,
  deletionID?: number | string
) => {
  let gridID = getGridID(gridType);
  let baseQuery = createProcessQuery(siteSchema, gridType);
  baseQuery += `&${gridID}=${deletionID!.toString()}`;
  return baseQuery;
};

export function getGridID(gridType: string): string {
  switch (gridType.trim()) {
    case 'coreMeasurements':
      return 'coreMeasurementID';
    case 'stemDimensions':
    case 'stemTaxonomies':
      return 'stemID';
    case 'attributes':
      return 'code';
    case 'census':
      return 'censusID';
    case 'personnel':
      return 'personnelID';
    case 'quadrats':
      return 'quadratID';
    case 'subquadrats':
      return 'subquadratID';
    case 'allTaxonomies':
    case 'species':
      return 'speciesID';
    default:
      return 'breakage';
  }
}

const comparePersonnelObjects = (obj1: any, obj2: any) => {
  return Object.entries(obj1).some(([key, value]) => obj2[key] !== value);
};

export function computeMutation(
  gridType: string,
  newRow: GridRowModel,
  oldRow: GridRowModel
) {
  switch (gridType) {
    case 'coreMeasurements':
      return coreMeasurementsFields.some(field => newRow[field] !== oldRow[field]);
    case 'attributes':
      return attributesFields.some(field => newRow[field] !== oldRow[field]);
    case 'census':
      return censusFields.some(field => newRow[field] !== oldRow[field]);
    case 'personnel':
      return personnelFields.some(field => newRow[field] !== oldRow[field]);
    case 'quadrats':
      return quadratsFields.some(field => {
        if (field === 'personnel') {
          // Special handling for 'personnel' field, which is an array
          return comparePersonnelObjects(newRow[field], oldRow[field]);
        }
        return newRow[field] !== oldRow[field];
      });
    case 'subquadrats':
      return subquadratsFields.some(field => newRow[field] !== oldRow[field]);
    case 'species':
      return speciesFields.some(field => newRow[field] !== oldRow[field]);
    // views
    case 'stemDimensionsView':
      return stemDimensionsViewFields.some(field => newRow[field] !== oldRow[field]);
    case 'stemTaxonomiesView':
      return stemTaxonomiesViewFields.some(field => newRow[field] !== oldRow[field]);
    case 'allTaxonomiesView':
      return allTaxonomiesFields.some(field => newRow[field] !== oldRow[field]);
    default:
      throw new Error('invalid grid type submitted');
  }
}

// templates need to match to the newRow objects being added in each respective DataGridCommons usage -- please ensure that these are set and maintained.
const newRowTemplates: Templates = {
  attributes: {
    id: { type: 'string' },
    code: { type: 'string', initialValue: '' },
    description: { type: 'string', initialValue: '' },
    status: { type: 'string', initialValue: '' },
    isNew: { type: 'boolean', initialValue: true }
  },
  census: {
    id: { type: 'string' },
    censusID: { type: 'number', initialValue: null }, // auto-incremented
    plotID: { type: 'number', initialValue: 0 },
    plotCensusNumber: { type: 'number', initialValue: 0 },
    startDate: { type: 'date' }, // Special handling for dates
    endDate: { type: 'date' }, // Special handling for dates
    description: { type: 'string', initialValue: '' },
    isNew: { type: 'boolean', initialValue: true }
  },
  personnel: {
    id: { type: 'string' },
    personnelID: { type: 'number', initialValue: null }, // null indicates auto-incremented
    firstName: { type: 'string', initialValue: '' },
    lastName: { type: 'string', initialValue: '' },
    role: { type: 'string', initialValue: '' },
    isNew: { type: 'boolean', initialValue: true }
  },
  quadrats: {
    id: { type: 'string' },
    quadratID: { type: 'number', initialValue: null }, // auto-incremented
    plotID: { type: 'number', initialValue: 0 },
    quadratName: { type: 'string', initialValue: '' },
    dimensionX: { type: 'number', initialValue: 0 },
    dimensionY: { type: 'number', initialValue: 0 },
    area: { type: 'number', initialValue: 0 },
    unit: {type: 'string', initialValue: ''},
    quadratShape: { type: 'string', initialValue: '' },
    personnel: { type: 'array', initialValue: [] },
    isNew: { type: 'boolean', initialValue: true }
  },
  subquadrats: {
    id: { type: 'string' },
    subquadratID: { type: 'number', initialValue: null }, // auto-incremented
    subquadratName: { type: 'string', initialValue: '' },
    quadratID: {type: 'number', initialValue: 0},
    x: { type: 'number', initialValue: 0 },
    y: { type: 'number', initialValue: 0 },
    unit: { type: 'string', initialValue: ''},
    ordering: { type: 'number', initialValue: 0 },
    isNew: { type: 'boolean', initialValue: true }
  },
  species: {
    id: { type: 'string' },
    speciesID: { type: 'number', initialValue: null },
    genusID: { type: 'number', initialValue: 0 },
    currentTaxonFlag: { type: 'boolean', initialValue: false },
    obsoleteTaxonFlag: { type: 'boolean', initialValue: false },
    speciesName: { type: 'string', initialValue: '' },
    subspeciesName: { type: 'string', initialValue: '' },
    speciesCode: { type: 'string', initialValue: '' },
    idLevel: { type: 'string', initialValue: '' },
    speciesAuthority: { type: 'string', initialValue: '' },
    subspeciesAuthority: { type: 'string', initialValue: '' },
    fieldFamily: { type: 'string', initialValue: '' },
    description: { type: 'string', initialValue: '' },
    referenceID: { type: 'number', initialValue: 0 },
    isNew: { type: 'boolean', initialValue: true }
  },
  stemDimensions: {
    id: { type: 'string' },
    stemID: { type: 'number', initialValue: null },
    stemTag: { type: 'string', initialValue: '' },
    treeID: { type: 'number', initialValue: 0 },
    treeTag: { type: 'string', initialValue: '' },
    stemLocalX: { type: 'number', initialValue: 0 },
    stemLocalY: { type: 'number', initialValue: 0 },
    stemUnits: { type: 'string', initialValue: '' },
    subquadratID: { type: 'number', initialValue: 0 },
    subquadratName: { type: 'string', initialValue: '' },
    subquadratDimensionX: { type: 'number', initialValue: 0 },
    subquadratDimensionY: { type: 'number', initialValue: 0 },
    subquadratX: { type: 'number', initialValue: 0 },
    subquadratY: { type: 'number', initialValue: 0 },
    subquadratUnits: { type: 'string', initialValue: '' },
    subquadratOrderPosition: { type: 'number', initialValue: 0 },
    quadratID: { type: 'number', initialValue: 0 },
    quadratName: { type: 'string', initialValue: '' },
    quadratDimensionX: { type: 'number', initialValue: 0 },
    quadratDimensionY: { type: 'number', initialValue: 0 },
    quadratUnits: { type: 'string', initialValue: '' },
    plotID: { type: 'number', initialValue: 0 },
    plotName: { type: 'string', initialValue: '' },
    locationName: { type: 'string', initialValue: '' },
    countryName: { type: 'string', initialValue: '' },
    plotDimensionX: { type: 'number', initialValue: 0 },
    plotDimensionY: { type: 'number', initialValue: 0 },
    plotGlobalX: { type: 'number', initialValue: 0 },
    plotGlobalY: { type: 'number', initialValue: 0 },
    plotGlobalZ: { type: 'number', initialValue: 0 },
    plotUnits: { type: 'string', initialValue: '' },
    isNew: { type: 'boolean', initialValue: true }
  },
  stemTaxonomies: {
    id: { type: 'string' },
    stemID: { type: 'number', initialValue: null },
    stemTag: { type: 'string', initialValue: '' },
    treeID: { type: 'number', initialValue: 0 },
    treeTag: { type: 'string', initialValue: '' },
    speciesID: { type: 'number', initialValue: 0 },
    speciesCode: { type: 'string', initialValue: '' },
    familyID: { type: 'number', initialValue: 0 },
    family: { type: 'string', initialValue: '' },
    genusID: { type: 'number', initialValue: 0 },
    genus: { type: 'string', initialValue: '' },
    speciesName: { type: 'string', initialValue: '' },
    subspeciesName: { type: 'string', initialValue: '' },
    currentTaxonFlag: { type: 'string', initialValue: '' },
    obsoleteTaxonFlag: { type: 'string', initialValue: '' },
    genusAuthority: { type: 'string', initialValue: '' },
    speciesAuthority: { type: 'string', initialValue: '' },
    subspeciesAuthority: { type: 'string', initialValue: '' },
    speciesIDLevel: { type: 'string', initialValue: '' },
    speciesFieldFamily: { type: 'string', initialValue: '' },
    isNew: { type: 'boolean', initialValue: true }
  },
  allTaxonomies: {
    id: { type: 'string' },
    speciesID: { type: 'number', initialValue: null },
    speciesCode: { type: 'string', initialValue: '' },
    family: { type: 'string', initialValue: '' },
    genus: { type: 'string', initialValue: '' },
    speciesName: { type: 'string', initialValue: '' },
    subspeciesName: { type: 'string', initialValue: '' },
    genusAuthority: { type: 'string', initialValue: '' },
    speciesAuthority: { type: 'string', initialValue: '' },
    subspeciesAuthority: { type: 'string', initialValue: '' },
    currentTaxonFlag: { type: 'boolean', initialValue: false },
    obsoleteTaxonFlag: { type: 'boolean', initialValue: false },
    fieldFamily: { type: 'string', initialValue: '' },
    speciesDescription: { type: 'string', initialValue: '' },
    publicationTitle: { type: 'string', initialValue: '' },
    dateOfPublication: { type: 'date' },
    citation: { type: 'string', initialValue: '' }
  }
};
