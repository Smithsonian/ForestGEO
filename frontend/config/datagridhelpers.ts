import { getQuadratHCs, Plot, Site } from '@/config/sqlrdsdefinitions/zones';
import { getAllTaxonomiesViewHCs, getAllViewFullTableViewsHCs, getMeasurementsSummaryViewHCs } from '@/config/sqlrdsdefinitions/views';
import { getPersonnelHCs } from '@/config/sqlrdsdefinitions/personnel';
import { getCoreMeasurementsHCs, getFailedMeasurementsHCs } from '@/config/sqlrdsdefinitions/core';
import { GridColDef, GridFilterModel, GridRowId, GridRowModel, GridRowModesModel, GridRowsProp, GridSortDirection } from '@mui/x-data-grid';
import { Dispatch, ReactElement, RefObject, SetStateAction } from 'react';
import { AlertProps } from '@mui/material';
import styled from '@emotion/styled';
import { getSpeciesLimitsHCs } from '@/config/sqlrdsdefinitions/taxonomies';
import { GridApiCommunity } from '@mui/x-data-grid/internals';
import { OrgCensus } from '@/config/sqlrdsdefinitions/timekeeping';
// Import and re-export types from servergridhelpers to avoid duplication
import type { FetchQueryFunction, ProcessPostPatchQueryFunction, ProcessDeletionQueryFunction } from '@/config/servergridhelpers';
export type { FetchQueryFunction, ProcessPostPatchQueryFunction, ProcessDeletionQueryFunction };

/**
 * Type for dynamic toolbar buttons in data grids
 */
export interface DynamicButton {
  label: string;
  onClick: () => void | Promise<void>;
  tooltip?: string;
  icon?: ReactElement;
}

export interface FieldTemplate {
  type: 'string' | 'number' | 'boolean' | 'array' | 'date' | 'unknown';
  initialValue?: string | number | boolean | unknown[] | null;
}

export type Templates = Record<string, Record<string, FieldTemplate>>;

const columnVisibilityMap: Record<string, Record<string, boolean>> = {
  default: {
    id: false
  },
  viewfulltable: {
    id: false,
    ...getAllViewFullTableViewsHCs()
  },
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
  speciesID?: number,
  filtered: boolean = false
): string => {
  const endpoint = filtered ? 'fixeddatafilter' : 'fixeddata';
  const baseUrl = `/api/${endpoint}/${gridType.toLowerCase()}/${siteSchema}/${page}/${pageSize}`;
  const segments = [plotID, plotCensusNumber, quadratID, speciesID].filter(seg => seg !== undefined && seg !== null);
  return segments.length > 0 ? `${baseUrl}/${segments.join('/')}` : baseUrl;
};

// Deprecated: Use createFetchQuery with filtered=true instead
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

export const createDeleteQuery: ProcessDeletionQueryFunction = (siteSchema: string, gridType: string, deletionID: number | string): string => {
  return `/api/fixeddata/${gridType}/${siteSchema}/${deletionID}`;
};

// Re-export server-safe utilities for backward compatibility
// Client components can import from here, server components should import from servergridhelpers
export { getGridID } from './servergridhelpers';

export type VisibleFilter = 'valid' | 'errors' | 'pending';
export type TSSFilter = 'multi stem' | 'old tree' | 'new recruit';

export interface ExtendedGridFilterModel extends GridFilterModel {
  visible: VisibleFilter[];
  tss: TSSFilter[];
}

export interface RowControl {
  show: boolean;
  toggle: (checked: boolean) => void;
  count: number;
}

export interface EditToolbarCustomProps {
  handleAddNewRow?: () => Promise<void>;
  handleRefresh?: () => Promise<void>;
  handleExport?: (visibility: VisibleFilter[], exportType: 'csv' | 'form') => Promise<string>;
  handleExportAll?: () => Promise<void>;
  handleExportCSV?: () => Promise<void>;
  showToolbarActions?: boolean;
  hidingEmptyColumns?: boolean;
  handleToggleHideEmptyColumns?: (checked: boolean) => void;
  handleQuickFilterChange?: (incomingFilterModel: GridFilterModel) => void;
  filterModel?: ExtendedGridFilterModel;
  apiRef?: RefObject<GridApiCommunity>;
  dynamicButtons?: DynamicButton[];
  locked?: boolean;
  currentSite?: Site;
  currentPlot?: Plot;
  currentCensus?: OrgCensus;
  gridColumns?: GridColDef[];
  gridType?: string;
  errorControls?: RowControl;
  validControls?: RowControl;
  pendingControls?: RowControl;
  hidingEmpty?: boolean;
  setHidingEmpty?: Dispatch<SetStateAction<boolean>>;
}

export interface IsolatedDataGridCommonProps {
  gridType: string;
  gridColumns: GridColDef[];
  refresh: boolean;
  setRefresh: Dispatch<SetStateAction<boolean>>;
  dynamicButtons: DynamicButton[];
  initialRow?: GridRowModel;
  fieldToFocus?: string;
  locked?: boolean;
  selectionOptions?: { value: string | number; label: string }[];
  handleOpenSpeciesLimits?: (id: GridRowId) => void;
  onDataUpdate?: (newRow: GridRowModel, oldRow: GridRowModel) => Promise<void>;
  onDataLoaded?: (rows: GridRowModel[]) => void;
  clusters?: Record<string, string[]>;
  defaultHideEmpty?: boolean;
  apiRef?: RefObject<GridApiCommunity>;
  adminEmail?: string;
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

export function allValuesAreNull(rows: GridRowsProp, field: string): boolean {
  return rows.length > 0 && rows.every(row => field === undefined || row[field] === undefined || row[field] === null || row[field] === '');
}

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
  initialVisibleFilters?: VisibleFilter[];
  showToolbarActions?: boolean;
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
  dynamicButtons: DynamicButton[];
  handleSelectQuadrat?: (quadratID: number | null) => void;
  locked?: boolean;
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
  'Invalid Codes': ['codes'],
  'Missing required field: TreeTag': ['tag'],
  'Missing required field: StemTag': ['stemTag'],
  'Missing required field: SpeciesCode': ['spCode'],
  'Missing required field: QuadratName': ['quadrat'],
  'Missing required field: MeasurementDate': ['date'],
  'TreeTag exceeds maximum length': ['tag'],
  'StemTag exceeds maximum length': ['stemTag'],
  'SpeciesCode exceeds maximum length': ['spCode'],
  'Comments exceed maximum length': ['description'],
  'Codes exceed maximum length': ['codes'],
  'Invalid DBH': ['dbh'],
  'Invalid HOM': ['hom'],
  'Invalid LocalX': ['x'],
  'Invalid LocalY': ['y'],
  'Missing measurement data': ['dbh', 'hom', 'codes'],
  'Invalid quadrat name': ['quadrat'],
  'Invalid quadrat reference': ['quadrat'],
  'Invalid species code': ['spCode'],
  'Invalid species reference': ['spCode'],
  'Duplicate entry': ['tag', 'stemTag', 'quadrat', 'date'],
  'Duplicate measurement row detected': ['tag', 'stemTag', 'quadrat', 'date'],
  'Quadrat mismatch': ['quadrat'],
  'Quadrat mismatch across censuses': ['quadrat'],
  'Coordinate drift': ['x', 'y'],
  'Coordinate drift exceeds allowed threshold': ['x', 'y'],
  'Coordinate value is negative': ['x', 'y'],
  'DBH must be non-negative': ['dbh'],
  'HOM must be non-negative': ['hom'],
  'SQL Exception': ['tag'],
  'Ingestion SQL exception': ['tag']
};

export const sortRowsByMeasurementDate = (rows: GridRowsProp, direction: GridSortDirection): GridRowsProp => {
  return rows.slice().sort((a, b) => {
    const dateA = new Date(a.measurementDate).getTime();
    const dateB = new Date(b.measurementDate).getTime();
    return direction === 'asc' ? dateA - dateB : dateB - dateA;
  });
};
