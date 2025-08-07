'use client';

import { GetApplyQuickFilterFn, GridColDef, GridFilterOperator } from '@mui/x-data-grid';

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
    return column;
  });
}

// customizing full filtration system
// multiple values operator:

const createNumericOperator = (label: string, operator: (value: number, filterValue: number) => boolean): GridFilterOperator => ({
  label,
  value: label,
  getApplyFilterFn: filterItem => {
    if (
      !filterItem.value ||
      !['measuredDBH', 'measuredHOM', 'startX', 'startY', 'area', 'dimensionX', 'dimensionY', 'stemLocalX', 'stemLocalY'].includes(filterItem.field || '')
    )
      return null;
    return (value, row) => {
      const fieldValue = Number(row[filterItem.field!]); // Get field value from the row
      return value != null && !isNaN(fieldValue) && operator(fieldValue, Number(filterItem.value));
    };
  },
  InputComponentProps: {}
});

export const customNumericOperators: GridFilterOperator[] = [
  createNumericOperator('>=', (value, filterValue) => value >= filterValue),
  createNumericOperator('>', (value, filterValue) => value > filterValue),
  createNumericOperator('=', (value, filterValue) => value === filterValue),
  createNumericOperator('<', (value, filterValue) => value < filterValue),
  createNumericOperator('<=', (value, filterValue) => value <= filterValue)
];
