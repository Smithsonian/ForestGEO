import styled from "@emotion/styled";
import { AlertProps } from "@mui/material";
import { GridColDef, GridRowsProp, GridRowModesModel, GridRowId, GridSortDirection, GridRowModel } from "@mui/x-data-grid";
import { Dispatch, SetStateAction } from "react";

export interface EditToolbarCustomProps {
  handleAddNewRow?: () => void;
  handleRefresh?: () => Promise<void>;
  locked?: boolean;
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
  snackbar: Pick<AlertProps, "children" | "severity"> | null;
  setSnackbar: Dispatch<SetStateAction<Pick<AlertProps, "children" | "severity"> | null>>;
  refresh: boolean;
  setRefresh: Dispatch<SetStateAction<boolean>>;
  paginationModel: { pageSize: number, page: number };
  setPaginationModel: Dispatch<SetStateAction<{ pageSize: number, page: number }>>;
  isNewRowAdded: boolean;
  setIsNewRowAdded: Dispatch<SetStateAction<boolean>>;
  shouldAddRowAfterFetch: boolean;
  setShouldAddRowAfterFetch: Dispatch<SetStateAction<boolean>>;
  addNewRowToGrid: () => void;
  handleSelectQuadrat?: (quadratID: number | null) => void;
  initialRow?: GridRowModel;
}

// Define types for the new states and props
export type PendingAction = {
  actionType: 'save' | 'delete' | '';
  actionId: GridRowId | null;
};

export interface ConfirmationDialogProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  message: string;
}

export const CellItemContainer = styled('div')({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
});

/**
 * Function to determine if all entries in a column are null
 */
export function allValuesAreNull(rows: GridRowsProp, field: string): boolean {
  return rows.length > 0 && rows.every(row => row[field] === null || row[field] === undefined);
}

/**
 * Function to filter out columns where all entries are null, except the actions column.
 */
export function filterColumns(rows: GridRowsProp, columns: GridColDef[]): GridColDef[] {
  return columns.filter(col => col.field === 'actions' || !allValuesAreNull(rows, col.field));
}

/**
 * Function to filter out columns where all entries are null, except the actions column.
 */
export function filterMSVColumns(rows: GridRowsProp, columns: GridColDef[]): GridColDef[] {
  return columns.filter(col => col.field === 'actions' || col.field === 'subquadrats' || col.field === "isValidated" || !allValuesAreNull(rows, col.field));
}


export interface MeasurementSummaryGridProps {
  gridColumns: GridColDef[];
  rows: GridRowsProp;
  setRows: Dispatch<SetStateAction<GridRowsProp>>;
  rowCount: number;
  setRowCount: Dispatch<SetStateAction<number>>;
  rowModesModel: GridRowModesModel;
  setRowModesModel: Dispatch<SetStateAction<GridRowModesModel>>;
  snackbar: Pick<AlertProps, "children" | "severity"> | null;
  setSnackbar: Dispatch<SetStateAction<Pick<AlertProps, "children" | "severity"> | null>>;
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
}

export const errorMapping: { [key: string]: string[] } = {
  '1': ["attributes"],
  '2': ["measuredDBH"],
  '3': ["measuredHOM"],
  '4': ["treeTag", "stemTag"],
  '5': ["treeTag", "stemTag", "quadratName"],
  '6': ["stemQuadX", "stemQuadY"],
  '7': ["speciesName"],
  '8': ["measurementDate"],
  '9': ["treeTag", "stemTag", "plotCensusNumber"],
  '10': ["treeTag", "stemTag", "plotCensusNumber"],
  '11': ["quadratName"],
  '12': ["speciesName"],
  '13': ["measuredDBH"],
  '14': ["measuredDBH"],
  '15': ["treeTag"],
  '16': ["quadratName"],
};

export const sortRowsByMeasurementDate = (rows: GridRowsProp, direction: GridSortDirection): GridRowsProp => {
  return rows.slice().sort((a, b) => {
    const dateA = new Date(a.measurementDate).getTime();
    const dateB = new Date(b.measurementDate).getTime();
    return direction === 'asc' ? dateA - dateB : dateB - dateA;
  });
};

export const areRowsDifferent = (row1: GridRowModel | null, row2: GridRowModel | null): boolean => {
  if (!row1 || !row2) {
    return true; // Consider them different if either row is null
  }

  const keys = Object.keys(row1);

  for (const key of keys) {
    if (row1[key] !== row2[key]) {
      return true; // If any value differs, the rows are different
    }
  }

  return false; // All values are identical
};