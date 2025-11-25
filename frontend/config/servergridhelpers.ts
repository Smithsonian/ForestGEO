/**
 * Server-safe grid helper utilities
 *
 * This file contains utilities that can be safely imported in both server-side
 * contexts (API routes) and client-side components. It has NO dependencies on
 * client-only libraries like @emotion/styled or React Context.
 *
 * For client-side specific utilities with styled components, see datagridhelpers.ts
 */

/**
 * Returns the primary key field name for a given grid/table type
 * Used by API routes to identify which field to use for record identification
 */
export function getGridID(gridType: string): string {
  switch (gridType.trim()) {
    case 'coremeasurements':
    case 'measurementssummaryview':
    case 'viewfulltableview':
    case 'measurementssummary':
    case 'viewfulltable':
      return 'coreMeasurementID';
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
    case 'roles':
      return 'roleID';
    case 'subquadrats':
      return 'subquadratID';
    case 'alltaxonomiesview':
    case 'species':
      return 'speciesID';
    case 'specieslimits':
      return 'speciesLimitID';
    case 'sitespecificvalidations':
      return 'validationID';
    case 'failedmeasurements':
      return 'failedMeasurementID';
    default:
      return 'breakage';
  }
}

/**
 * Type definitions for query builder functions
 */
export type FetchQueryFunction = (
  siteSchema: string,
  gridType: string,
  page: number,
  pageSize: number,
  plotID?: number,
  plotCensusNumber?: number,
  quadratID?: number,
  speciesID?: number,
  filtered?: boolean
) => string;

export type ProcessPostPatchQueryFunction = (siteSchema: string, dataType: string, gridID: string, plotID?: number, censusID?: number) => string;
export type ProcessDeletionQueryFunction = (siteSchema: string, dataType: string, gridID: string, deletionID: number | string) => string;

/**
 * Creates a fetch query URL for the fixeddata or fixeddatafilter API endpoints
 */
export const createFetchQuery: FetchQueryFunction = (
  siteSchema: string,
  gridType,
  page,
  pageSize,
  plotID?,
  plotCensusNumber?,
  quadratID?: number,
  speciesID?: number,
  filtered: boolean = false
): string => {
  const endpoint = filtered ? 'fixeddatafilter' : 'fixeddata';
  return `/api/${endpoint}/${gridType.toLowerCase()}/${siteSchema}/${page}/${pageSize}/${plotID ?? ``}/${plotCensusNumber ?? ``}/${quadratID ?? ``}/${speciesID ?? ``}`;
};

/**
 * @deprecated Use createFetchQuery with filtered=true instead
 * Creates a fetch query URL for the fixeddatafilter API endpoint
 */
export const createQFFetchQuery: FetchQueryFunction = (
  siteSchema: string,
  gridType,
  page,
  pageSize,
  plotID?,
  plotCensusNumber?,
  quadratID?: number,
  speciesID?: number
): string => {
  return createFetchQuery(siteSchema, gridType, page, pageSize, plotID, plotCensusNumber, quadratID, speciesID, true);
};

/**
 * Creates a POST/PATCH query URL for updating data
 */
export const createPostPatchQuery: ProcessPostPatchQueryFunction = (
  siteSchema: string,
  dataType: string,
  gridID: string,
  plotID?: number,
  plotCensusNumber?: number
) => {
  return `/api/fixeddata/${dataType}/${siteSchema}/${gridID}` + (plotID ? `/${plotID}` : '') + (plotCensusNumber ? `/${plotCensusNumber}` : '');
};

/**
 * Creates a DELETE query URL for removing data
 */
export const createDeleteQuery: ProcessDeletionQueryFunction = (siteSchema: string, gridType: string, deletionID: number | string): string => {
  return `/api/fixeddata/${gridType}/${siteSchema}/${deletionID}`;
};
