/**
 * Defines templates for new rows in data grids
 */
// datagridhelpers.ts
import { getCoreMeasurementsHCs } from './sqlrdsdefinitions/tables/coremeasurementsrds';
import { getQuadratHCs } from './sqlrdsdefinitions/tables/quadratrds';
import { getAllTaxonomiesViewHCs } from './sqlrdsdefinitions/views/alltaxonomiesviewrds';
import { getMeasurementsSummaryViewHCs } from './sqlrdsdefinitions/views/measurementssummaryviewrds';
import { getStemTaxonomiesViewHCs } from './sqlrdsdefinitions/views/stemtaxonomiesviewrds';
import { getAllViewFullTableViewsHCs } from './sqlrdsdefinitions/views/viewfulltableviewrds';

export interface FieldTemplate {
  type: 'string' | 'number' | 'boolean' | 'array' | 'date' | 'unknown';
  initialValue?: string | number | boolean | any[] | null;
}

export interface Templates {
  [gridType: string]: {
    [fieldName: string]: FieldTemplate;
  };
}

export type FetchQueryFunction = (
  siteSchema: string,
  gridType: string,
  page: number,
  pageSize: number,
  plotID?: number,
  censusID?: number,
  quadratID?: number,
  pending?: boolean
) => string;

export type ProcessPostPatchQueryFunction = (
  // incorporated validation system into this too
  siteSchema: string,
  dataType: string,
  gridID: string
) => string;
export type ProcessDeletionQueryFunction = (siteSchema: string, dataType: string, gridID: string, deletionID: number | string) => string;

const columnVisibilityMap: { [key: string]: { [key: string]: boolean } } = {
  default: {
    id: false
  },
  viewfulltableview: {
    id: false,
    ...getAllViewFullTableViewsHCs()
  },
  // views
  alltaxonomiesview: {
    id: false,
    ...getAllTaxonomiesViewHCs()
  },
  measurementssummary: {
    id: false,
    ...getMeasurementsSummaryViewHCs()
  },
  measurementssummaryview: {
    id: false,
    ...getMeasurementsSummaryViewHCs()
  },
  stemtaxonomiesview: {
    id: false,
    ...getStemTaxonomiesViewHCs()
  },
  coremeasurements: {
    id: false,
    ...getCoreMeasurementsHCs()
  },
  quadrats: {
    id: false,
    ...getQuadratHCs()
  }
};

export const getColumnVisibilityModel = (gridType: string): { [key: string]: boolean } => {
  return columnVisibilityMap[gridType] || columnVisibilityMap.default;
};

export const createPostPatchQuery: ProcessPostPatchQueryFunction = (siteSchema: string, dataType: string, gridID: string) => {
  return `/api/fixeddata/${dataType}/${siteSchema}/${gridID}`;
};
export const createFetchQuery: FetchQueryFunction = (
  siteSchema: string,
  gridType,
  page,
  pageSize,
  plotID?,
  plotCensusNumber?,
  quadratID?: number,
  pending?: boolean
) => {
  return (
    `/api/fixeddata/${gridType.toLowerCase()}/${siteSchema}/${page}/${pageSize}/${plotID}/${plotCensusNumber}` +
    `${quadratID ? `/${quadratID}` : ``}` +
    `${pending ? `?pending=${pending}` : ``}`
  );
};

export const createDeleteQuery: ProcessDeletionQueryFunction = (siteSchema: string, gridType: string, deletionID: number | string) => {
  return `/api/fixeddata/${gridType}/${siteSchema}/${deletionID}`;
};

export function getGridID(gridType: string): string {
  switch (gridType.trim()) {
    case 'coremeasurements':
    case 'measurementssummaryview':
    case 'viewfulltableview':
    case 'measurementssummary': // materialized view --> should not be modified
    case 'viewfulltable': // materialized view --> should not be modified
      return 'coreMeasurementID';
    case 'stemtaxonomiesview':
      return 'stemID';
    case 'attributes':
      return 'code';
    case 'census':
      return 'censusID';
    case 'personnel':
      return 'personnelID';
    case 'quadrats':
      return 'quadratID';
    case 'quadratpersonnel':
      return 'quadratPersonnelID';
    case 'subquadrats':
      return 'subquadratID';
    case 'alltaxonomiesview':
    case 'species':
      return 'speciesID';
    case 'validationprocedures':
      return 'validationID';
    default:
      return 'breakage';
  }
}
