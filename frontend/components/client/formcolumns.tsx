'use client';

import { GridColDef, GridRenderEditCellParams, useGridApiContext, useGridApiRef } from '@mui/x-data-grid';
import { areaSelectionOptions, unitSelectionOptions } from '@/config/macros';
import { formatHeader } from '@/components/client/datagridcolumns';
import moment from 'moment/moment';
import { Box, Input, Tooltip } from '@mui/joy';
import { DatePicker } from '@mui/x-date-pickers';
import React, { useEffect, useRef, useState } from 'react';
import useEnhancedEffect from '@mui/utils/useEnhancedEffect';

const renderDatePicker = (params: GridRenderEditCellParams) => {
  const convertedValue = params.row.date ? moment(params.row.date, 'YYYY-MM-DD') : null;
  if (!convertedValue) return <></>;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'row', gap: '0.5em', alignItems: 'center' }}>
      <DatePicker label={'Recorded Date'} value={convertedValue} disabled />
    </Box>
  );
};

const renderEditDatePicker = (params: GridRenderEditCellParams) => {
  const apiRef = useGridApiRef();
  const { id, row } = params;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'row', gap: '0.5em', alignItems: 'center' }}>
      <DatePicker
        label={'Recorded Date'}
        value={moment(row.date, 'YYYY-MM-DD')}
        onChange={newValue => {
          apiRef.current.setEditCellValue({ id, field: 'date', value: newValue ? newValue.format('YYYY-MM-DD') : null });
        }}
      />
    </Box>
  );
};

function levenshteinDistance(a: string, b: string): number {
  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // Deletion
        matrix[i][j - 1] + 1, // Insertion
        matrix[i - 1][j - 1] + cost // Substitution
      );
    }
  }
  return matrix[a.length][b.length];
}

const getClosestUnit = (input: string): string | null => {
  const normalizedInput = input.trim().toLowerCase();

  // Define threshold for acceptable "closeness" (tune this value)
  const threshold = 2;

  let closestUnit: string | null = null;
  let minDistance = Infinity;

  for (const option of unitSelectionOptions) {
    const distance = levenshteinDistance(normalizedInput, option);
    if (distance < minDistance && distance <= threshold) {
      minDistance = distance;
      closestUnit = option;
    }
  }

  // Return the closest match if within the acceptable threshold, otherwise return null
  return closestUnit;
};

const getClosestAreaUnit = (input: string): string | null => {
  const normalizedInput = input.trim().toLowerCase();

  // Define threshold for acceptable "closeness" (tune this value)
  const threshold = 2;

  let closestUnit: string | null = null;
  let minDistance = Infinity;

  for (const option of areaSelectionOptions) {
    const distance = levenshteinDistance(normalizedInput, option);
    if (distance < minDistance && distance <= threshold) {
      minDistance = distance;
      closestUnit = option;
    }
  }

  // Return the closest match if within the acceptable threshold, otherwise return null
  return closestUnit;
};

const EditUnitsCell = (params: GridRenderEditCellParams & { fieldName: string; isArea: boolean }) => {
  const apiRef = useGridApiContext();
  const { id, fieldName, hasFocus, isArea } = params;
  const [value, setValue] = useState<string>(params.row[fieldName]);
  const [error, setError] = useState<boolean>(false);
  const ref = useRef<HTMLDivElement>(null);

  useEnhancedEffect(() => {
    if (hasFocus && ref.current) {
      const input = ref.current.querySelector<HTMLInputElement>(`input[value="${value}"]`);
      input?.focus();
    }
  }, [hasFocus, value]);

  useEffect(() => {
    if (!(apiRef.current.getCellMode(id, fieldName) === 'edit')) {
      apiRef.current.startCellEditMode({ id, field: fieldName });
    }
  }, [apiRef, id, fieldName]);

  useEffect(() => {
    setError(!(isArea ? getClosestAreaUnit(value) : getClosestUnit(value)));
  }, [value]);

  const handleCommit = () => {
    const isValid = isArea ? getClosestAreaUnit(value) : getClosestUnit(value);

    if (!isValid) {
      apiRef.current.setEditCellValue({
        id,
        field: fieldName,
        value: ''
      });
      return;
    }

    apiRef.current.stopCellEditMode({ id, field: fieldName });
  };

  return (
    <Tooltip title={error ? 'Invalid unit entered!' : `${isArea ? areaSelectionOptions.join(', ') : unitSelectionOptions.join(', ')}`} color={'primary'}>
      <Input
        ref={ref}
        fullWidth
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={() => {
          apiRef.current.setEditCellValue({
            id,
            field: fieldName,
            value: (isArea ? getClosestAreaUnit(value) : getClosestUnit(value)) || value
          });
          handleCommit();
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            apiRef.current.setEditCellValue({
              id,
              field: fieldName,
              value: (isArea ? getClosestAreaUnit(value) : getClosestUnit(value)) || value
            });
            handleCommit();
          }
        }}
        error={error}
      />
    </Tooltip>
  );
};

export const AttributesFormGridColumns: GridColDef[] = [
  {
    field: 'id',
    headerName: '#',
    headerClassName: 'header',
    flex: 0.3,
    align: 'right',
    headerAlign: 'right',
    editable: false
  },
  {
    field: 'code',
    headerName: 'Code',
    headerClassName: 'header',
    minWidth: 250,
    flex: 1,
    align: 'left',
    editable: true
  },
  {
    field: 'description',
    headerName: 'Description',
    headerClassName: 'header',
    minWidth: 250,
    flex: 1,
    align: 'left',
    editable: true
  },
  {
    field: 'status',
    headerName: 'Status',
    headerClassName: 'header',
    minWidth: 250,
    flex: 1,
    align: 'left',
    editable: true
  }
];

export const PersonnelFormGridColumns: GridColDef[] = [
  {
    field: 'id',
    headerName: '#',
    headerClassName: 'header',
    flex: 0.3,
    align: 'right',
    headerAlign: 'right',
    editable: false
  },
  {
    field: 'firstname',
    headerName: 'First Name',
    headerClassName: 'header',
    minWidth: 250,
    flex: 1,
    align: 'left',
    editable: true
  },
  {
    field: 'lastname',
    headerName: 'Last Name',
    headerClassName: 'header',
    minWidth: 250,
    flex: 1,
    align: 'left',
    editable: true
  },
  {
    field: 'role',
    headerName: 'Role',
    headerClassName: 'header',
    minWidth: 250,
    flex: 1,
    align: 'left',
    editable: true
  },
  {
    field: 'roledescription',
    headerName: 'Role Description',
    headerClassName: 'header',
    minWidth: 250,
    flex: 1,
    align: 'left',
    editable: true
  }
];

export const SpeciesFormGridColumns: GridColDef[] = [
  {
    field: 'id',
    headerName: '#',
    headerClassName: 'header',
    flex: 0.3,
    align: 'right',
    headerAlign: 'right',
    editable: false
  },
  {
    field: 'spcode',
    headerName: 'Species Code',
    headerClassName: 'header',
    minWidth: 250,
    flex: 1,
    align: 'left',
    editable: true
  },
  {
    field: 'family',
    headerName: 'Family',
    headerClassName: 'header',
    minWidth: 250,
    flex: 1,
    align: 'left',
    editable: true
  },
  {
    field: 'genus',
    headerName: 'Genus',
    headerClassName: 'header',
    minWidth: 250,
    flex: 1,
    align: 'left',
    editable: true
  },
  {
    field: 'species',
    headerName: 'Species',
    headerClassName: 'header',
    minWidth: 250,
    flex: 1,
    align: 'left',
    editable: true
  },
  {
    field: 'subspecies',
    headerName: 'Subspecies',
    headerClassName: 'header',
    minWidth: 250,
    flex: 1,
    align: 'left',
    editable: true
  },
  {
    field: 'idlevel',
    headerName: 'ID Level',
    headerClassName: 'header',
    minWidth: 250,
    flex: 1,
    align: 'left',
    editable: true
  },
  {
    field: 'authority',
    headerName: 'Authority',
    headerClassName: 'header',
    minWidth: 250,
    flex: 1,
    align: 'left',
    editable: true
  },
  {
    field: 'subspeciesauthority',
    headerName: 'Subspecies Authority',
    headerClassName: 'header',
    minWidth: 250,
    flex: 1,
    align: 'left',
    editable: true
  }
];

export const QuadratsFormGridColumns: GridColDef[] = [
  {
    field: 'id',
    headerName: '#',
    headerClassName: 'header',
    flex: 0.3,
    align: 'right',
    headerAlign: 'right',
    editable: false
  },
  {
    field: 'quadrat',
    headerName: 'Quadrat Name',
    headerClassName: 'header',
    minWidth: 250,
    flex: 1,
    align: 'left',
    editable: true
  },
  {
    field: 'startx',
    headerName: 'StartX',
    headerClassName: 'header',
    minWidth: 250,
    flex: 1,
    align: 'left',
    type: 'number',
    editable: true
  },
  {
    field: 'starty',
    headerName: 'StartY',
    headerClassName: 'header',
    minWidth: 250,
    flex: 1,
    align: 'left',
    type: 'number',
    editable: true
  },
  {
    field: 'coordinateunit',
    headerName: 'Coordinate Units',
    headerClassName: 'header',
    flex: 0.3,
    align: 'left',
    editable: true,
    renderEditCell: params => <EditUnitsCell {...params} fieldName={'coordinateunit'} isArea={false} />
  },
  {
    field: 'dimx',
    headerName: 'Dimension X',
    headerClassName: 'header',
    minWidth: 250,
    flex: 1,
    align: 'left',
    type: 'number',
    editable: true
  },
  {
    field: 'dimy',
    headerName: 'Dimension Y',
    headerClassName: 'header',
    minWidth: 250,
    flex: 1,
    align: 'left',
    type: 'number',
    editable: true
  },
  {
    field: 'dimensionunit',
    headerName: 'Dimension Units',
    headerClassName: 'header',
    flex: 0.3,
    align: 'left',
    editable: true,
    renderEditCell: params => <EditUnitsCell {...params} fieldName={'dimensionunit'} isArea={false} />
  },
  {
    field: 'area',
    headerName: 'Area',
    headerClassName: 'header',
    minWidth: 250,
    flex: 1,
    align: 'left',
    type: 'number',
    editable: true
  },
  {
    field: 'areaunit',
    headerName: 'Area Units',
    headerClassName: 'header',
    flex: 0.3,
    align: 'left',
    editable: true,
    renderEditCell: params => <EditUnitsCell {...params} fieldName={'areaunit'} isArea={true} />
  },
  {
    field: 'quadratshape',
    headerName: 'Quadrat Shape',
    headerClassName: 'header',
    minWidth: 250,
    flex: 1,
    align: 'left',
    editable: true
  }
];
/**
 *   [FormType.measurements]: [
 *     { label: 'tag' },
 *     { label: 'stemtag' },
 *     { label: 'spcode' },
 *     { label: 'quadrat' },
 *     { label: 'lx' },
 *     { label: 'ly' },
 *     { label: 'coordinateunit' },
 *     { label: 'dbh' },
 *     { label: 'dbhunit' },
 *     { label: 'hom' },
 *     { label: 'homunit' },
 *     { label: 'date' },
 *     { label: 'codes' }
 *   ],
 */
export const MeasurementsFormGridColumns: GridColDef[] = [
  {
    field: 'id',
    headerName: '#',
    headerClassName: 'header',
    flex: 0.3,
    align: 'right',
    headerAlign: 'right',
    editable: false
  },
  {
    field: 'tag',
    headerName: 'Tree Tag',
    headerClassName: 'header',
    renderHeader: () => formatHeader('Tree', 'Tag'),
    flex: 0.75,
    align: 'center',
    editable: true
  },
  {
    field: 'stemtag',
    headerName: 'Stem Tag',
    headerClassName: 'header',
    renderHeader: () => formatHeader('Stem', 'Tag'),
    flex: 0.75,
    align: 'center',
    editable: true
  },
  {
    field: 'spcode',
    headerName: 'Species Code',
    headerClassName: 'header',
    renderHeader: () => formatHeader('Species', 'Code'),
    flex: 0.75,
    align: 'center',
    editable: true
  },
  {
    field: 'quadrat',
    headerName: 'Quadrat Name',
    headerClassName: 'header',
    renderHeader: () => formatHeader('Quadrat', 'Name'),
    flex: 0.75,
    align: 'center',
    editable: true
  },
  {
    field: 'lx',
    headerName: 'X',
    headerClassName: 'header',
    flex: 0.3,
    align: 'center',
    type: 'number',
    editable: true
  },
  {
    field: 'ly',
    headerName: 'Y',
    headerClassName: 'header',
    flex: 0.3,
    align: 'center',
    type: 'number',
    editable: true
  },
  {
    field: 'coordinateunit',
    headerName: 'Coordinate Units',
    headerClassName: 'header',
    renderHeader: () => formatHeader('Coordinate', 'Units'),
    flex: 1.5,
    align: 'center',
    editable: true,
    renderEditCell: params => <EditUnitsCell {...params} fieldName={'coordinateunit'} isArea={false} />
  },
  {
    field: 'dbh',
    headerName: 'DBH',
    headerClassName: 'header',
    flex: 0.75,
    align: 'center',
    type: 'number',
    editable: true
  },
  {
    field: 'dbhunit',
    headerName: 'DBH Units',
    headerClassName: 'header',
    renderHeader: () => formatHeader('DBH', 'Units'),
    flex: 1.5,
    align: 'center',
    editable: true,
    renderEditCell: params => <EditUnitsCell {...params} fieldName={'dbhunit'} isArea={false} />
  },
  {
    field: 'hom',
    headerName: 'HOM',
    headerClassName: 'header',
    flex: 0.75,
    align: 'center',
    type: 'number',
    editable: true
  },
  {
    field: 'homunit',
    headerName: 'HOM Units',
    headerClassName: 'header',
    renderHeader: () => formatHeader('HOM', 'Units'),
    flex: 1.5,
    align: 'center',
    editable: true,
    renderEditCell: params => <EditUnitsCell {...params} fieldName={'homunit'} isArea={false} />
  },
  {
    field: 'date',
    headerName: 'Date',
    headerClassName: 'header',
    flex: 1,
    align: 'center',
    editable: true,
    renderCell: renderDatePicker,
    renderEditCell: renderEditDatePicker
  },
  {
    field: 'codes',
    headerName: 'Codes',
    headerClassName: 'header',
    flex: 1,
    align: 'center',
    editable: true
  }
];
