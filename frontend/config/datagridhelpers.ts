/**
 * Defines templates for new rows in data grids
 */
// datagridhelpers.ts
import { getQuadratHCs, Plot, Site } from '@/config/sqlrdsdefinitions/zones';
import { getAllTaxonomiesViewHCs, getAllViewFullTableViewsHCs, getMeasurementsSummaryViewHCs } from '@/config/sqlrdsdefinitions/views';
import { getPersonnelHCs } from '@/config/sqlrdsdefinitions/personnel';
import { getCoreMeasurementsHCs } from '@/config/sqlrdsdefinitions/core';
import { GridColDef, GridFilterModel, GridRowId, GridRowModel, GridRowModesModel, GridRowsProp, GridSortDirection } from '@mui/x-data-grid';
import { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { AlertProps } from '@mui/material';
import styled from '@emotion/styled';
import { getSpeciesLimitsHCs } from '@/config/sqlrdsdefinitions/taxonomies';
import { GridApiCommunity } from '@mui/x-data-grid/internals';
import { OrgCensus } from '@/config/sqlrdsdefinitions/timekeeping';

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

const columnVisibilityMap: { [key: string]: { [key: string]: boolean } } = {
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

export const getColumnVisibilityModel = (gridType: string): { [key: string]: boolean } => {
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
    case 'validationprocedures':
      return 'validationID';
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
  hidingEmptyColumns?: boolean;
  handleToggleHideEmptyColumns?: (checked: boolean) => void;
  handleQuickFilterChange?: (incomingFilterModel: GridFilterModel) => void;
  filterModel?: ExtendedGridFilterModel;
  apiRef?: MutableRefObject<GridApiCommunity>;
  dynamicButtons?: any;
  locked?: boolean;
  currentSite?: Site;
  currentPlot?: Plot;
  currentCensus?: OrgCensus;
  gridColumns?: GridColDef[];
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
export type PendingAction = {
  actionType: 'save' | 'delete' | '';
  actionId: GridRowId | null;
};
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
  return rows.length > 0 && rows.every(row => row[field] === undefined || row[field] === null || row[field] === '');
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

export const errorMapping: { [key: string]: string[] } = {
  '1': ['attributes'],
  '2': ['measuredDBH'],
  '3': ['measuredHOM'],
  '4': ['treeTag', 'stemTag'],
  '5': ['treeTag', 'stemTag', 'quadratName'],
  '6': ['stemLocalX', 'stemLocalY'],
  '7': ['speciesCode'],
  '8': ['measurementDate'],
  '9': ['treeTag', 'stemTag', 'plotCensusNumber'],
  '10': ['treeTag', 'stemTag', 'plotCensusNumber'],
  '11': ['quadratName'],
  '12': ['speciesCode'],
  '13': ['measuredDBH', 'measuredHOM']
};
export const sortRowsByMeasurementDate = (rows: GridRowsProp, direction: GridSortDirection): GridRowsProp => {
  return rows.slice().sort((a, b) => {
    const dateA = new Date(a.measurementDate).getTime();
    const dateB = new Date(b.measurementDate).getTime();
    return direction === 'asc' ? dateA - dateB : dateB - dateA;
  });
};
