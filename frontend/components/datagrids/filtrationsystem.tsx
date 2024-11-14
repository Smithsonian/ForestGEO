'use client';

import { GetApplyQuickFilterFn, GridColDef, GridFilterInputValueProps, GridFilterOperator, useGridRootProps } from '@mui/x-data-grid';
import { TextField, TextFieldProps } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { Box } from '@mui/joy';
import SyncIcon from '@mui/icons-material/Sync';

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
function InputNumberInterval(props: GridFilterInputValueProps) {
  const rootProps = useGridRootProps();
  const { item, applyValue, focusElementRef = null } = props;

  const filterTimeout = useRef<any>();
  const [filterValueState, setFilterValueState] = useState<[string, string]>(item.value ?? '');
  const [applying, setIsApplying] = useState(false);

  useEffect(() => {
    return () => {
      clearTimeout(filterTimeout.current);
    };
  }, []);

  useEffect(() => {
    const itemValue = item.value ?? [undefined, undefined];
    setFilterValueState(itemValue);
  }, [item.value]);

  const updateFilterValue = (lowerBound: string, upperBound: string) => {
    clearTimeout(filterTimeout.current);
    setFilterValueState([lowerBound, upperBound]);

    setIsApplying(true);
    filterTimeout.current = setTimeout(() => {
      setIsApplying(false);
      applyValue({ ...item, value: [lowerBound, upperBound] });
    }, rootProps.filterDebounceMs);
  };

  const handleUpperFilterChange: TextFieldProps['onChange'] = event => {
    const newUpperBound = event.target.value;
    updateFilterValue(filterValueState[0], newUpperBound);
  };
  const handleLowerFilterChange: TextFieldProps['onChange'] = event => {
    const newLowerBound = event.target.value;
    updateFilterValue(newLowerBound, filterValueState[1]);
  };

  return (
    <Box
      sx={{
        display: 'inline-flex',
        flexDirection: 'row',
        alignItems: 'end',
        height: 48,
        pl: '20px'
      }}
    >
      <TextField
        name="lower-bound-input"
        placeholder="From"
        label="From"
        variant="standard"
        value={Number(filterValueState[0])}
        onChange={handleLowerFilterChange}
        type="number"
        inputRef={focusElementRef}
        sx={{ mr: 2 }}
      />
      <TextField
        name="upper-bound-input"
        placeholder="To"
        label="To"
        variant="standard"
        value={Number(filterValueState[1])}
        onChange={handleUpperFilterChange}
        type="number"
        slotProps={{
          input: applying ? { endAdornment: <SyncIcon /> } : undefined
        }}
      />
    </Box>
  );
}

export const betweenOperator: GridFilterOperator<any, number> = {
  label: 'Between',
  value: 'between',
  getApplyFilterFn: filterItem => {
    if (!Array.isArray(filterItem.value) || filterItem.value.length !== 2) {
      return null;
    }
    if (filterItem.value[0] == null || filterItem.value[1] == null) {
      return null;
    }
    return (value: number) => {
      return value != null && filterItem.value[0] <= value && value <= filterItem.value[1];
    };
  },
  InputComponent: InputNumberInterval
};
