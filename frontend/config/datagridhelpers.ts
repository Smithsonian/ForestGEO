/**
 * Defines templates for new rows in data grids
 */
// datagridhelpers.ts
import { getQuadratHCs, Plot, Site } from '@/config/sqlrdsdefinitions/zones';
import { getAllTaxonomiesViewHCs, getAllViewFullTableViewsHCs, getMeasurementsSummaryViewHCs } from '@/config/sqlrdsdefinitions/views';
import { getPersonnelHCs } from '@/config/sqlrdsdefinitions/personnel';
import { getCoreMeasurementsHCs, getFailedMeasurementsHCs } from '@/config/sqlrdsdefinitions/core';
import { GridColDef, GridFilterModel, GridRowId, GridRowModel, GridRowModesModel, GridRowsProp, GridSortDirection } from '@mui/x-data-grid';
import { Dispatch, RefObject, SetStateAction } from 'react';
import { AlertProps } from '@mui/material';
import styled from '@emotion/styled';
import { getSpeciesLimitsHCs } from '@/config/sqlrdsdefinitions/taxonomies';
import { GridApiCommunity } from '@mui/x-data-grid/internals';
import { OrgCensus } from '@/config/sqlrdsdefinitions/timekeeping';

export interface FieldTemplate {
  type: 'string' | 'number' | 'boolean' | 'array' | 'date' | 'unknown';
  initialValue?: string | number | boolean | any[] | null;
}

export type Templates = Record<string, Record<string, FieldTemplate>>;

export type FetchQueryFunction = (
  siteSchema: string,
  gridType: string,
  page: number,
  pageSize: number,
  plotID?: number,
  plotCensusNumber?: number,
  quadratID?: number,
  speciesID?: number // This is a special case for specieslimits
) => string;

export type ProcessPostPatchQueryFunction = (
  // incorporated validation system into this too
  siteSchema: string,
  dataType: string,
  gridID: string,
  plotID?: number,
  censusID?: number
) => string;
export type ProcessDeletionQueryFunction = (siteSchema: string, dataType: string, gridID: string, deletionID: number | string) => string;

const columnVisibilityMap: Record<string, Record<string, boolean>> = {
  default: {
    id: false
  },
  viewfulltable: {
    id: false,
    ...getAllViewFullTableViewsHCs()
  },
  // views
  alltaxonomiesview: {
    id: false,
    ...getAllTaxonomiesViewHCs()
  },
  species: {
    id: false,
    ...getAllTaxonomiesViewHCs()
  },
  measurements: {
    id: false,
    ...getMeasurementsSummaryViewHCs()
  },
  failedmeasurements: {
    id: false,
    ...getFailedMeasurementsHCs()
  },
  measurementssummary: {
    id: false,
    ...getMeasurementsSummaryViewHCs()
  },
  measurementssummaryview: {
    id: false,
    ...getMeasurementsSummaryViewHCs()
  },
  coremeasurements: {
    id: false,
    ...getCoreMeasurementsHCs()
  },
  quadrats: {
    id: false,
    ...getQuadratHCs()
  },
  personnel: {
    id: false,
    ...getPersonnelHCs()
  },
  specieslimits: {
    id: false,
    ...getSpeciesLimitsHCs()
  },
  unifiedchangelog: {
    id: false,
    changeID: false,
    changedBy: false
  }
};

export const getColumnVisibilityModel = (gridType: string): Record<string, boolean> => {
  return columnVisibilityMap[gridType] || columnVisibilityMap.default;
};
export const createPostPatchQuery: ProcessPostPatchQueryFunction = (
  siteSchema: string,
  dataType: string,
  gridID: string,
  plotID?: number,
  plotCensusNumber?: number
) => {
  return `/api/fixeddata/${dataType}/${siteSchema}/${gridID}` + (plotID ? `/${plotID}` : '') + (plotCensusNumber ? `/${plotCensusNumber}` : '');
};
export const createFetchQuery: FetchQueryFunction = (
  siteSchema: string,
  gridType,
  page,
  pageSize,
  plotID?,
  plotCensusNumber?,
  quadratID?: number,
  speciesID?: number
): string => {
  return `/api/fixeddata/${gridType.toLowerCase()}/${siteSchema}/${page}/${pageSize}/${plotID ?? ``}/${plotCensusNumber ?? ``}/${quadratID ?? ``}/${speciesID ?? ``}`;
};

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
  return `/api/fixeddatafilter/${gridType.toLowerCase()}/${siteSchema}/${page}/${pageSize}/${plotID ?? ``}/${plotCensusNumber ?? ``}/${quadratID ?? ``}/${speciesID ?? ``}`;
};

export const createDeleteQuery: ProcessDeletionQueryFunction = (siteSchema: string, gridType: string, deletionID: number | string): string => {
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
    case 'attributes':
      return 'code';
    case 'census':
      return 'censusID';
    case 'personnel':
    case 'personnelrole':
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

type VisibleFilter = 'valid' | 'errors' | 'pending';

interface ExtendedGridFilterModel extends GridFilterModel {
  visible: VisibleFilter[];
}

export interface EditToolbarCustomProps {
  handleAddNewRow?: () => Promise<void>;
  handleRefresh?: () => Promise<void>;
  handleExport?: (visibility: VisibleFilter[], exportType: 'csv' | 'form') => Promise<string>;
  handleExportAll?: () => Promise<void>;
  handleExportCSV?: () => Promise<void>;
  hidingEmptyColumns?: boolean;
  handleToggleHideEmptyColumns?: (checked: boolean) => void;
  handleQuickFilterChange?: (incomingFilterModel: GridFilterModel) => void;
  filterModel?: ExtendedGridFilterModel;
  apiRef?: RefObject<GridApiCommunity>;
  dynamicButtons?: any;
  locked?: boolean;
  currentSite?: Site;
  currentPlot?: Plot;
  currentCensus?: OrgCensus;
  gridColumns?: GridColDef[];
  gridType?: string;
}

export interface IsolatedDataGridCommonProps {
  gridType: string;
  gridColumns: GridColDef[];
  refresh: boolean;
  setRefresh: Dispatch<SetStateAction<boolean>>;
  dynamicButtons: any[];
  initialRow?: GridRowModel;
  fieldToFocus?: string;
  locked?: boolean;
  selectionOptions?: { value: string | number; label: string }[];
  handleOpenSpeciesLimits?: (id: GridRowId) => void;
  onDataUpdate?: () => void; // Add the onDataUpdate prop
  clusters?: Record<string, string[]>;
  defaultHideEmpty?: boolean;
  apiRef?: RefObject<GridApiCommunity>;
}

export interface DataGridCommonProps {
  gridType: string;
  gridColumns: GridColDef[];
  rows: GridRowsProp;
  setRows: Dispatch<SetStateAction<GridRowsProp>>;
  rowCount: number;
  setRowCount: Dispatch<SetStateAction<number>>;
  rowModesModel: GridRowModesModel;
  setRowModesModel: Dispatch<SetStateAction<GridRowModesModel>>;
  snackbar: Pick<AlertProps, 'children' | 'severity'> | null;
  setSnackbar: Dispatch<SetStateAction<Pick<AlertProps, 'children' | 'severity'> | null>>;
  refresh: boolean;
  setRefresh: Dispatch<SetStateAction<boolean>>;
  paginationModel: { pageSize: number; page: number };
  setPaginationModel: Dispatch<SetStateAction<{ pageSize: number; page: number }>>;
  isNewRowAdded: boolean;
  setIsNewRowAdded: Dispatch<SetStateAction<boolean>>;
  shouldAddRowAfterFetch: boolean;
  setShouldAddRowAfterFetch: Dispatch<SetStateAction<boolean>>;
  addNewRowToGrid: () => void;
  handleSelectQuadrat?: (quadratID: number | null) => void;
  initialRow?: GridRowModel;
  locked?: boolean;
  selectionOptions?: { value: string | number; label: string }[];
  handleOpenSpeciesLimits?: (id: GridRowId) => void;
}

// Define types for the new states and props
export interface PendingAction {
  actionType: 'save' | 'delete' | '';
  actionId: GridRowId | null;
}

export const CellItemContainer = styled('div')({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%'
});

/**
 * Function to determine if all entries in a column are null
 */
export function allValuesAreNull(rows: GridRowsProp, field: string): boolean {
  return rows.length > 0 && rows.every(row => field === undefined || row[field] === undefined || row[field] === null || row[field] === '');
}

/**
 * Function to filter out columns where all entries are null, except the actions column.
 */
export function filterColumns(rows: GridRowsProp, columns: GridColDef[]): GridColDef[] {
  return columns.filter(
    col =>
      col.field === 'actions' ||
      col.field === 'dimensionX' ||
      col.field === 'dimensionY' ||
      col.field === 'subspeciesName' ||
      col.field === 'speciesLimits' ||
      col.field === 'isValidated' ||
      !allValuesAreNull(rows, col.field)
  );
}

export interface MeasurementsCommonsProps {
  gridType: string;
  gridColumns: GridColDef[];
  rows: GridRowsProp;
  setRows: Dispatch<SetStateAction<GridRowsProp>>;
  rowCount: number;
  setRowCount: Dispatch<SetStateAction<number>>;
  rowModesModel: GridRowModesModel;
  setRowModesModel: Dispatch<SetStateAction<GridRowModesModel>>;
  snackbar: Pick<AlertProps, 'children' | 'severity'> | null;
  setSnackbar: Dispatch<SetStateAction<Pick<AlertProps, 'children' | 'severity'> | null>>;
  refresh: boolean;
  setRefresh: Dispatch<SetStateAction<boolean>>;
  paginationModel: { pageSize: number; page: number };
  setPaginationModel: Dispatch<SetStateAction<{ pageSize: number; page: number }>>;
  isNewRowAdded: boolean;
  setIsNewRowAdded: Dispatch<SetStateAction<boolean>>;
  shouldAddRowAfterFetch: boolean;
  setShouldAddRowAfterFetch: Dispatch<SetStateAction<boolean>>;
  addNewRowToGrid: () => void;
  handleSelectQuadrat?: (quadratID: number | null) => void;
  locked?: boolean;
  dynamicButtons: any[];
}

export const failureErrorMapping: Record<string, string[]> = {
  'SpCode missing': ['spCode'],
  'SpCode invalid': ['spCode'],
  'Missing Tree Tag': ['tag'],
  'Missing Tree and Stem Tag': ['tag', 'stemTag'],
  'Quadrat missing': ['quadrat'],
  'Quadrat invalid': ['quadrat'],
  'Missing X': ['x'],
  'Missing Y': ['y'],
  'Missing Codes and DBH': ['codes', 'dbh'],
  'Missing Codes and HOM': ['codes', 'hom'],
  'Missing Date': ['date'],
  'Invalid Codes': ['codes']
};

export const sortRowsByMeasurementDate = (rows: GridRowsProp, direction: GridSortDirection): GridRowsProp => {
  return rows.slice().sort((a, b) => {
    const dateA = new Date(a.measurementDate).getTime();
    const dateB = new Date(b.measurementDate).getTime();
    return direction === 'asc' ? dateA - dateB : dateB - dateA;
  });
};
