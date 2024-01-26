// datagridhelpers.ts
import {GridRowModel} from "@mui/x-data-grid";

export type FetchQueryFunction = (gridType: string, page: number, pageSize: number, plotID?: number) => string;
export type ProcessQueryFunction = (gridType: string, deletionID?: number) => string;

export interface EditToolbarProps {
  handleAddNewRow: () => void;
  handleRefresh: () => Promise<void>;
}

export const createProcessQuery: ProcessQueryFunction = (gridType: string) => {
  let baseQuery = `/api/`;
  switch(gridType) {
    case 'coreMeasurements':
      baseQuery += `${gridType.toLowerCase()}`
      break;
    case 'census':
    case 'quadrats':
    case 'attributes':
    case 'personnel':
    case 'species':
    case 'subSpecies':
      baseQuery += `fixeddata/${gridType.toLowerCase()}`;
      break;
    default:
      throw new Error('invalid gridtype selected');
  }
  return baseQuery;
}
export const createFetchQuery: FetchQueryFunction = (gridType, page, pageSize, plotID) => {
  let baseQuery = `/api/`;
  switch(gridType) {
    case 'coreMeasurements':
      baseQuery += `${gridType.toLowerCase()}?page=${page}&pageSize=${pageSize}`;
      baseQuery += plotID ? `&plotID=${plotID}` : ``;
      break;
    case 'census':
    case 'quadrats':
      baseQuery += `fixeddata/${gridType}?page=${page}&pageSize=${pageSize}`;
      baseQuery += plotID ? `&plotID=${plotID}` : ``;
      break;
    case 'attributes':
    case 'personnel':
    case 'species':
    case 'subSpecies':
      baseQuery += `fixeddata/${gridType.toLowerCase()}?page=${page}&pageSize=${pageSize}`;
      break;
    default:
      throw new Error('invalid gridtype selected');
  }
  return baseQuery;
};

export const createDeleteQuery: ProcessQueryFunction = (gridType: string, deletionID?: number) => {
  let gridID = getGridID(gridType);
  let baseQuery = createProcessQuery(gridType);
  baseQuery += `?${gridID}=${deletionID!.toString()}`;
  return baseQuery;
}

export function getGridID(gridType: string) {
  switch(gridType) {
    case 'coreMeasurements': return 'coreMeasurementID';
    case 'attributes': return 'code';
    case 'census': return 'censusID';
    case 'quadrats': return 'quadratID';
    case 'species': return 'speciesID';
    case 'subSpecies': return 'subSpeciesID';
    default: throw new Error('Invalid grid type submitted');
  }
}

export function computeMutation(gridType: string, newRow: GridRowModel, oldRow: GridRowModel) {
  let fields: string[] = [];
  switch(gridType) {
    case 'coreMeasurements':
      fields = [
        'censusID', 'plotID', 'quadratID', 'treeID', 'stemID', 'personnelID',
        'isRemeasurement', 'isCurrent', 'measurementDate', 'measuredDBH',
        'measuredHOM', 'description', 'userDefinedFields'
      ];
      break;
    case 'attributes':
      fields = [
        'code', 'description', 'status'
      ];
      break;
    case 'census':
      fields = [
        'censusID', 'plotID', 'plotCensusNumber', 'startDate', 'endDate', 'description'
      ];
      break;
    case 'personnel':
      fields = [
        'personnelID', 'firstName', 'lastName', 'role'
      ];
      break;
    case 'quadrats':
      fields = [
        'quadratID', 'plotID', 'quadratName', 'quadratX', 'quadratY', 'quadratZ',
        'dimensionX', 'dimensionY', 'area', 'quadratShape'
      ]
      break;
    case 'species':
      fields  = [
        'speciesID', 'genusID', 'currentTaxonFlag', 'obsoleteTaxonFlag', 'speciesName', 'speciesCode',
        'idLevel', 'authority', 'fieldFamily', 'description', 'referenceID'
      ]
      break;
    case 'subSpecies':
      fields = [
        'subSpeciesID', 'speciesID', 'subSpeciesName', 'subSpeciesCode',
        'currentTaxonFlag', 'obsoleteTaxonFlag', 'authority', 'infraSpecificLevel'
      ]
      break;
    default:
      throw new Error('invalid grid type submitted');
  }
  return fields.some(field => newRow[field] !== oldRow[field]);
}
