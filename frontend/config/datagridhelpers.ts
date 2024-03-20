// datagridhelpers.ts
import {GridRowModel} from "@mui/x-data-grid";

const coreMeasurementsFields = [
  'censusID', 'plotID', 'quadratID', 'treeID', 'stemID', 'personnelID',
  'isValidated', 'measurementDate', 'measuredDBH',
  'measuredHOM', 'description', 'userDefinedFields'
];

const attributesFields = [
  'code', 'description', 'status'
];

const censusFields = [
  'plotID', 'plotCensusNumber', 'startDate', 'endDate', 'description'
];

const personnelFields = [
  'firstName', 'lastName', 'role'
];

const quadratsFields = [
  'plotID', 'censusID', 'quadratName', 'dimensionX', 'dimensionY', 'area', 'quadratShape', 'personnel'
];

const speciesFields = [
  'genusID', 'currentTaxonFlag', 'obsoleteTaxonFlag', 'speciesName', 'speciesCode',
  'idLevel', 'authority', 'fieldFamily', 'description', 'referenceID'
];

const subSpeciesFields = [
  'speciesID', 'subSpeciesName', 'subSpeciesCode',
  'currentTaxonFlag', 'obsoleteTaxonFlag', 'authority', 'infraSpecificLevel'
];

interface FieldTemplate {
  type: 'string' | 'number' | 'boolean' | 'array' | 'date' | 'unknown';
  initialValue?: string | number | boolean | any[] | null;
}

interface Templates {
  [gridType: string]: {
    [fieldName: string]: FieldTemplate;
  };
}

const newRowTemplates: Templates = {
  attributes: {
    id: {type: 'string'},
    code: {type: 'string', initialValue: ''},
    description: {type: 'string', initialValue: ''},
    status: {type: 'string', initialValue: ''},
    isNew: { type: 'boolean', initialValue: true }
  },
  census: {
    id: { type: 'string' },
    censusID: { type: 'number', initialValue: null }, // auto-incremented
    plotID: { type: 'number', initialValue: 0 },
    plotCensusNumber: { type: 'number', initialValue: 0 },
    startDate: { type: 'date' }, // Special handling for dates
    endDate: { type: 'date' },   // Special handling for dates
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
    quadratShape: { type: 'string', initialValue: '' },
    personnel: { type: 'array', initialValue: [] },
    isNew: { type: 'boolean', initialValue: true }
  },
  species: {
    id: {type: 'string'},
    speciesID: {type: 'number', initialValue: null},
    genusID: {type: 'number', initialValue: 0},
    currentTaxonFlag: {type: 'boolean', initialValue: false},
    obsoleteTaxonFlag: {type: 'boolean', initialValue: false},
    speciesName: {type: 'string', initialValue: ''},
    speciesCode: {type: 'string', initialValue: ''},
    idLevel: {type: 'string', initialValue: ''},
    authority: {type: 'string', initialValue: ''},
    fieldFamily: {type: 'string', initialValue: ''},
    description: {type: 'string', initialValue: ''},
    referenceID: {type: 'number', initialValue: 0},
    isNew: {type: 'boolean', initialValue: true}
  },
  subSpecies: {
    id: {type: 'string'},
    subSpeciesID: {type: 'number', initialValue: null},
    subSpeciesName: {type: 'string', initialValue: ''},
    subSpeciesCode: {type: 'string', initialValue: ''},
    currentTaxonFlag: {type: 'boolean', initialValue: false},
    obsoleteTaxonFlag: {type: 'boolean', initialValue: false},
    authority: {type: 'string', initialValue: ''},
    infraSpecificLevel: {type: 'string', initialValue: ''},
    isNew: {type: 'boolean', initialValue: true}
  }
};

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

export function validateRowStructure(gridType: string, oldRow: GridRowModel): boolean {
  const template = newRowTemplates[gridType];
  if (!template) {
    throw new Error('Invalid grid type submitted');
  }

  const currentDate = new Date();

  return Object.keys(template).every((key) => {
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

export type FetchQueryFunction = (siteSchema: string, gridType: string, page: number, pageSize: number, plotID?: number) => string;
export type ProcessQueryFunction = (siteSchema: string, gridType: string, deletionID?: number) => string;

export interface EditToolbarProps {
  locked?: boolean;
  handleAddNewRow: () => void;
  handleRefresh: () => Promise<void>;
}

export const createProcessQuery: ProcessQueryFunction = (siteSchema: string, gridType: string) => {
  let baseQuery = `/api/`;
  switch (gridType) {
    case 'coreMeasurements':
      baseQuery += `${gridType.toLowerCase()}?schema=${siteSchema}`
      break;
    case 'census':
    case 'quadrats':
    case 'attributes':
    case 'personnel':
    case 'species':
    case 'subSpecies':
      baseQuery += `fixeddata/${gridType.toLowerCase()}?schema=${siteSchema}`;
      break;
    default:
      throw new Error('invalid gridtype selected');
  }
  return baseQuery;
}
export const createFetchQuery: FetchQueryFunction = (siteSchema: string, gridType, page, pageSize, plotID) => {
  let baseQuery = `/api/`;
  switch (gridType) {
    case 'coreMeasurements':
      baseQuery += `${gridType.toLowerCase()}?schema=${siteSchema}&page=${page}&pageSize=${pageSize}`;
      baseQuery += plotID ? `&plotID=${plotID}` : ``;
      break;
    case 'census':
    case 'quadrats':
      baseQuery += `fixeddata/${gridType}?schema=${siteSchema}&page=${page}&pageSize=${pageSize}`;
      baseQuery += plotID ? `&plotID=${plotID}` : ``;
      break;
    case 'measurementsSummary':
      baseQuery += `fixeddata/${gridType.toLowerCase()}?schema=${siteSchema}&page=${page}&pageSize=${pageSize}`;
      baseQuery += plotID ? `&plotID=${plotID}` : ``;
      break;
    case 'attributes':
    case 'personnel':
    case 'species':
    case 'subSpecies':
      baseQuery += `fixeddata/${gridType.toLowerCase()}?schema=${siteSchema}&page=${page}&pageSize=${pageSize}`;
      break;
    default:
      throw new Error('invalid gridtype selected');
  }
  return baseQuery;
};

export const createDeleteQuery: ProcessQueryFunction = (siteSchema: string, gridType: string, deletionID?: number) => {
  let gridID = getGridID(gridType);
  let baseQuery = createProcessQuery(siteSchema, gridType);
  baseQuery += `&${gridID}=${deletionID!.toString()}`;
  return baseQuery;
}

export function getGridID(gridType: string) {
  switch (gridType) {
    case 'coreMeasurements':
      return 'coreMeasurementID';
    case 'attributes':
      return 'code';
    case 'census':
      return 'censusID';
    case 'personnel':
      return 'personnelID';
    case 'quadrats':
      return 'quadratID';
    case 'species':
      return 'speciesID';
    case 'subSpecies':
      return 'subSpeciesID';
    default:
      throw new Error('Invalid grid type submitted');
  }
}

export function postOrPatch(gridType: string, oldRow: GridRowModel) {
  switch(gridType) {
    case 'coreMeasurements':

  }
}

export function computeMutation(gridType: string, newRow: GridRowModel, oldRow: GridRowModel) {
  let fields: string[] = [];
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
      return quadratsFields.some(field => newRow[field] !== oldRow[field]);
    case 'species':
      return speciesFields.some(field => newRow[field] !== oldRow[field]);
    case 'subSpecies':
      return subSpeciesFields.some(field => newRow[field] !== oldRow[field]);
    default:
      throw new Error('invalid grid type submitted');
  }
}