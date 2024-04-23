/**
 * Defines templates for new rows in data grids
 */
// datagridhelpers.ts
import {GridRowModel, GridToolbarProps} from '@mui/x-data-grid';

export const coreMeasurementsFields = [
  'censusID',
  'plotID',
  'quadratID',
  'treeID',
  'stemID',
  'personnelID',
  'isValidated',
  'measurementDate',
  'measuredDBH',
  'measuredHOM',
  'description',
  'userDefinedFields'
];

export const attributesFields = ['code', 'description', 'status'];

export const censusFields = [
  'plotID',
  'plotCensusNumber',
  'startDate',
  'endDate',
  'description'
];

export const stemTreeDetailsFields = [
  'stemTag',
  'treeTag',
  'speciesName',
  'subSpeciesName',
  'quadratName',
  'plotName',
  'locationName',
  'countryName',
  'quadratDimensionX',
  'quadratDimensionY',
  'stemQuadX',
  'stemQuadY',
  'stemDescription'
];

export const personnelFields = ['firstName', 'lastName', 'role'];

export const quadratsFields = [
  'plotID',
  'censusID',
  'quadratName',
  'dimensionX',
  'dimensionY',
  'area',
  'quadratShape',
  'personnel'
];

export const speciesFields = [
  'genusID',
  'currentTaxonFlag',
  'obsoleteTaxonFlag',
  'speciesName',
  'speciesCode',
  'idLevel',
  'authority',
  'fieldFamily',
  'description',
  'referenceID'
];

export const subSpeciesFields = [
  'speciesID',
  'subSpeciesName',
  'subSpeciesCode',
  'currentTaxonFlag',
  'obsoleteTaxonFlag',
  'authority',
  'infraSpecificLevel'
];

export const validationHistoryFields = [
  'validationRunID',
  'procedureName',
  'runDatetime',
  'targetRowID',
  'validationOutcome',
  'errorMessage',
  'validationCriteria',
  'measuredValue',
  'expectedValueRange',
  'additionalDetails'
];

interface FieldTemplate {
  type: 'string' | 'number' | 'boolean' | 'array' | 'date' | 'unknown'
  initialValue?: string | number | boolean | any[] | null
}

interface Templates {
  [gridType: string]: {
    [fieldName: string]: FieldTemplate
  }
}

const newRowTemplates: Templates = {
  attributes: {
    id: {type: 'string'},
    code: {type: 'string', initialValue: ''},
    description: {type: 'string', initialValue: ''},
    status: {type: 'string', initialValue: ''},
    isNew: {type: 'boolean', initialValue: true}
  },
  census: {
    id: {type: 'string'},
    censusID: {type: 'number', initialValue: null}, // auto-incremented
    plotID: {type: 'number', initialValue: 0},
    plotCensusNumber: {type: 'number', initialValue: 0},
    startDate: {type: 'date'}, // Special handling for dates
    endDate: {type: 'date'}, // Special handling for dates
    description: {type: 'string', initialValue: ''},
    isNew: {type: 'boolean', initialValue: true}
  },
  personnel: {
    id: {type: 'string'},
    personnelID: {type: 'number', initialValue: null}, // null indicates auto-incremented
    firstName: {type: 'string', initialValue: ''},
    lastName: {type: 'string', initialValue: ''},
    role: {type: 'string', initialValue: ''},
    isNew: {type: 'boolean', initialValue: true}
  },
  quadrats: {
    id: {type: 'string'},
    quadratID: {type: 'number', initialValue: null}, // auto-incremented
    plotID: {type: 'number', initialValue: 0},
    quadratName: {type: 'string', initialValue: ''},
    dimensionX: {type: 'number', initialValue: 0},
    dimensionY: {type: 'number', initialValue: 0},
    area: {type: 'number', initialValue: 0},
    quadratShape: {type: 'string', initialValue: ''},
    personnel: {type: 'array', initialValue: []},
    isNew: {type: 'boolean', initialValue: true}
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
  },
  validationHistory: {
    id: {type: 'string'},
    validationRunID: {type: 'number', initialValue: 0},
    procedureName: {type: 'string', initialValue: ''},
    runDatetime: {type: 'date'},
    targetRowID: {type: 'number', initialValue: null},
    validationOutcome: {type: 'string', initialValue: ''},
    errorMessage: {type: 'string', initialValue: ''},
    validationCriteria: {type: 'string', initialValue: ''},
    measuredValue: {type: 'string', initialValue: ''},
    expectedValueRange: {type: 'string', initialValue: ''},
    additionalDetails: {type: 'string', initialValue: ''},
    isNew: {type: 'boolean', initialValue: true}
  },
  stemTreeDetails: {
    id: {type: 'string'},
    stemTag: {type: 'string', initialValue: ''},
    treeTag: {type: 'string', initialValue: ''},
    speciesName: {type: 'string', initialValue: ''},
    subSpeciesName: {type: 'string', initialValue: ''},
    quadratName: {type: 'string', initialValue: ''},
    plotName: {type: 'string', initialValue: ''},
    locationName: {type: 'string', initialValue: ''},
    countryName: {type: 'string', initialValue: ''},
    quadratDimensionX: {type: 'number', initialValue: 0},
    quadratDimensionY: {type: 'number', initialValue: 0},
    stemQuadX: {type: 'number', initialValue: 0},
    stemQuadY: {type: 'number', initialValue: 0},
    stemDescription: {type: 'string', initialValue: ''},
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
  plotID?: number
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
    case 'stemTreeDetails':
      baseQuery += `${gridType.toLowerCase()}?schema=${siteSchema}`;
      break;
    case 'coreMeasurements':
    case 'census':
    case 'quadrats':
    case 'subquadrats':
    case 'attributes':
    case 'personnel':
    case 'species':
    case 'subSpecies':
    case 'validationHistory':
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
  plotID
) => {
  let baseQuery = `/api/`;
  switch (gridType) {
    case 'coreMeasurements':
    case 'census':
    case 'quadrats':
    case 'subquadrats':
    case 'measurementsSummary':
      baseQuery += `fixeddata/${gridType.toLowerCase()}?schema=${siteSchema}&page=${page}&pageSize=${pageSize}`;
      baseQuery += plotID ? `&plotID=${plotID}` : ``;
      break;
    case 'attributes':
    case 'personnel':
    case 'species':
    case 'subSpecies':
    case 'validationHistory':
    case 'stemTreeDetails':
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
    case 'stemTreeDetails':
      return 'stemID';
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
    case 'validationHistory':
      return 'validationRunID';
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
      return coreMeasurementsFields.some(
        field => newRow[field] !== oldRow[field]
      );
    case 'stemTreeDetails':
      return stemTreeDetailsFields.some(
        field => newRow[field] !== oldRow[field]
      );
    case 'attributes':
      return attributesFields.some(field => newRow[field] !== oldRow[field]);
    case 'census':
      return censusFields.some(field => newRow[field] !== oldRow[field]);
    case 'personnel':
      return personnelFields.some(field => newRow[field] !== oldRow[field]);
    case 'quadrats':
      return quadratsFields.some(field => {
        if (field === 'personnel') {
          console.log('old row personnel: ', oldRow[field]);
          console.log('new row personnel: ', newRow[field]);
          // Special handling for 'personnel' field, which is an array
          return comparePersonnelObjects(newRow[field], oldRow[field]);
        }
        return newRow[field] !== oldRow[field];
      });
    case 'species':
      return speciesFields.some(field => newRow[field] !== oldRow[field]);
    case 'subSpecies':
      return subSpeciesFields.some(field => newRow[field] !== oldRow[field]);
    case 'validationHistory':
      return validationHistoryFields.some(field => newRow[field] !== oldRow[field]);
    default:
      throw new Error('invalid grid type submitted');
  }
}
