'use client';

import { GetApplyQuickFilterFn, getGridNumericOperators, GridColDef, GridFilterOperator } from '@mui/x-data-grid';

// starting with quick filter
export const getApplyQuickFilterFnSameYear: GetApplyQuickFilterFn<any, unknown> = value => {
  if (!value || value.length !== 4 || !/\d{4}/.test(value)) {
    return null;
  }
  return cellValue => {
    if (cellValue instanceof Date) {
      return cellValue.getFullYear() === Number(value);
    }
    return false;
  };
};

// Custom quick filter for quadrat names
// If the input is a 4-digit string (e.g., "0000", "0101"), do exact match
// Otherwise, do a contains match for partial searches
export const getApplyQuickFilterFnQuadratName: GetApplyQuickFilterFn<any, unknown> = value => {
  if (!value) {
    return null;
  }

  const searchValue = String(value).trim();

  // If it's a 4-digit string, treat as exact quadrat name match
  if (/^\d{4}$/.test(searchValue)) {
    return cellValue => {
      const cellString = String(cellValue ?? '');
      return cellString === searchValue;
    };
  }

  // Otherwise, do a contains match (case-insensitive)
  const lowerSearchValue = searchValue.toLowerCase();
  return cellValue => {
    const cellString = String(cellValue ?? '').toLowerCase();
    return cellString.includes(lowerSearchValue);
  };
};

export function applyFilterToColumns(columns: GridColDef[]) {
  return columns.map(column => {
    if (column.field === 'dateCreated') {
      return {
        ...column,
        getApplyQuickFilterFn: getApplyQuickFilterFnSameYear
      };
    }
    if (column.field === 'name') {
      return {
        ...column,
        getApplyQuickFilterFn: undefined
      };
    }
    if (column.field === 'quadratName') {
      return {
        ...column,
        getApplyQuickFilterFn: getApplyQuickFilterFnQuadratName
      };
    }
    return column;
  });
}

// Use MUI's built-in numeric operators which include proper InputComponent rendering.
// Server-side filtering (filterMode="server") handles the actual SQL — these operators
// only control the UI (operator labels + input fields).
export const customNumericOperators: GridFilterOperator[] = getGridNumericOperators();
