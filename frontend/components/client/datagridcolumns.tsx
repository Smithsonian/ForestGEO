import { CELL_ALIGN, HEADER_ALIGN, unitSelectionOptions } from '@/config/macros';
import { Box, FormHelperText, Input, Option, Select, Stack, Typography } from '@mui/joy';
import { GridColDef, useGridApiRef } from '@mui/x-data-grid';
import React, { useEffect, useState } from 'react';
import { AttributeStatusOptions } from '@/config/sqlrdsdefinitions/core';

export const formatHeader = (word1: string, word2: string) => (
  <Stack direction={'column'} sx={{ width: '100%', alignItems: 'center', justifyContent: 'center' }}>
    <Typography level="body-sm" fontWeight={'bold'}>
      {word1}
    </Typography>
    <Typography level="body-xs">{word2}</Typography>
  </Stack>
);

export const quadratGridColumns: GridColDef[] = [
  {
    field: 'id',
    headerName: '#',
    headerClassName: 'header',
    flex: 0.3,
    align: CELL_ALIGN,
    headerAlign: HEADER_ALIGN,
    editable: false
  },
  {
    field: 'quadratID',
    headerName: '#',
    headerClassName: 'header',
    flex: 0.3,
    align: CELL_ALIGN,
    headerAlign: HEADER_ALIGN,
    editable: false
  },
  {
    field: 'quadratName',
    headerName: 'Quadrat Name',
    headerClassName: 'header',
    renderHeader: () => formatHeader('Quadrat', 'Name'),
    flex: 0.75,
    align: CELL_ALIGN,
    headerAlign: HEADER_ALIGN,
    type: 'string',
    editable: true
  },
  {
    field: 'startX',
    headerName: 'X',
    headerClassName: 'header',
    flex: 0.5,
    align: CELL_ALIGN,
    headerAlign: HEADER_ALIGN,
    type: 'number',
    valueFormatter: (value: any) => {
      return Number(value).toFixed(2);
    },
    editable: true
  },
  {
    field: 'startY',
    headerName: 'Y',
    headerClassName: 'header',
    flex: 0.5,
    align: CELL_ALIGN,
    headerAlign: HEADER_ALIGN,
    type: 'number',
    valueFormatter: (value: any) => {
      return Number(value).toFixed(2);
    },
    editable: true
  },
  {
    field: 'area',
    headerName: 'Area',
    headerClassName: 'header',
    flex: 0.75,
    align: CELL_ALIGN,
    headerAlign: HEADER_ALIGN,
    type: 'number',
    valueFormatter: (value: any) => {
      return Number(value).toFixed(2);
    },
    editable: true
  },
  {
    field: 'dimensionX',
    headerName: 'DimX',
    headerClassName: 'header',
    flex: 1,
    renderHeader: () => formatHeader('Dimension', 'X'),
    headerAlign: HEADER_ALIGN,
    align: CELL_ALIGN,
    type: 'number',
    valueFormatter: (value: any) => {
      let parsedValue = Number(value);
      if (isNaN(value)) parsedValue = 0.0;
      return parsedValue.toFixed(2);
    },
    editable: true
  },
  {
    field: 'dimensionY',
    headerName: 'DimY',
    headerClassName: 'header',
    flex: 1,
    renderHeader: () => formatHeader('Dimension', 'Y'),
    align: CELL_ALIGN,
    headerAlign: HEADER_ALIGN,
    type: 'number',
    valueFormatter: (value: any) => {
      let parsedValue = Number(value);
      if (isNaN(value)) parsedValue = 0.0;
      return parsedValue.toFixed(2);
    },
    editable: true
  },
  {
    field: 'quadratShape',
    headerName: 'Quadrat Shape',
    headerClassName: 'header',
    flex: 1,
    renderHeader: () => formatHeader('Quadrat', 'Shape'),
    align: CELL_ALIGN,
    headerAlign: HEADER_ALIGN,
    type: 'string',
    editable: true
  }
];

export const AttributeGridColumns: GridColDef[] = [
  {
    field: 'id',
    headerName: '#',
    headerClassName: 'header',
    flex: 0.3,
    align: CELL_ALIGN,
    headerAlign: HEADER_ALIGN,
    editable: false
  },
  { field: 'code', headerName: 'Code', headerClassName: 'header', minWidth: 150, flex: 1, editable: true }, // all unique ID columns need to be tagged 'id'
  {
    field: 'description',
    headerName: 'Description',
    headerClassName: 'header',
    headerAlign: HEADER_ALIGN,
    minWidth: 250,
    flex: 1,
    align: 'left',
    editable: true
  },
  {
    field: 'status',
    headerName: 'Status',
    headerClassName: 'header',
    headerAlign: HEADER_ALIGN,
    minWidth: 150,
    flex: 1,
    align: 'left',
    editable: true,
    type: 'singleSelect',
    valueOptions: AttributeStatusOptions
  }
];

export const PersonnelGridColumns: GridColDef[] = [
  {
    field: 'id',
    headerName: '#',
    headerClassName: 'header',
    flex: 0.3,
    align: CELL_ALIGN,
    headerAlign: HEADER_ALIGN,
    editable: false
  },
  {
    field: 'personnelID',
    headerName: 'PersonnelID',
    headerClassName: 'header',
    headerAlign: HEADER_ALIGN,
    flex: 1,
    align: 'left',
    editable: false
  },
  {
    field: 'censusID',
    headerName: 'Census ID',
    headerAlign: HEADER_ALIGN,
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    editable: true
  },
  {
    field: 'firstName',
    headerName: 'First Name',
    headerClassName: 'header',
    headerAlign: HEADER_ALIGN,
    flex: 1,
    align: 'left',
    editable: true
  },
  {
    field: 'lastName',
    headerName: 'Last Name',
    headerAlign: HEADER_ALIGN,
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    editable: true
  }
];

export const StemTaxonomiesViewGridColumns: GridColDef[] = [
  {
    field: 'id',
    headerName: '#',
    headerClassName: 'header',
    flex: 0.3,
    align: CELL_ALIGN,
    headerAlign: HEADER_ALIGN,
    editable: false
  },
  { field: 'stemID', headerName: '#', headerClassName: 'header', flex: 0.1, align: 'left', headerAlign: HEADER_ALIGN },
  { field: 'stemTag', headerName: 'Stem Tag', headerClassName: 'header', flex: 1, align: 'left', headerAlign: HEADER_ALIGN },
  { field: 'treeID', headerName: 'Tree ID', headerClassName: 'header', flex: 1, align: 'left', headerAlign: HEADER_ALIGN },
  { field: 'treeTag', headerName: 'Tree Tag', headerClassName: 'header', flex: 1, align: 'left', headerAlign: HEADER_ALIGN },
  { field: 'speciesID', headerName: 'Species ID', headerClassName: 'header', flex: 1, align: 'left', headerAlign: HEADER_ALIGN },
  {
    field: 'speciesCode',
    headerName: 'Species Code',
    renderHeader: () => formatHeader('Species', 'Code'),
    headerClassName: 'header',
    headerAlign: HEADER_ALIGN,
    flex: 1,
    align: 'left'
  },
  { field: 'familyID', headerName: 'Family ID', headerClassName: 'header', flex: 1, align: 'left', headerAlign: HEADER_ALIGN },
  { field: 'family', headerName: 'Family', headerClassName: 'header', flex: 1, align: 'left', headerAlign: HEADER_ALIGN },
  { field: 'genusID', headerName: 'Genus ID', headerClassName: 'header', flex: 1, align: 'left', headerAlign: HEADER_ALIGN },
  { field: 'genus', headerName: 'Genus', headerClassName: 'header', flex: 1, align: 'left', headerAlign: HEADER_ALIGN },
  { field: 'speciesName', headerName: 'Species', headerClassName: 'header', flex: 1, align: 'left', headerAlign: HEADER_ALIGN },
  { field: 'subspeciesName', headerName: 'Subspecies', headerClassName: 'header', flex: 1, align: 'left', headerAlign: HEADER_ALIGN },
  {
    field: 'genusAuthority',
    headerName: 'Genus Authority',
    renderHeader: () => formatHeader('Genus', 'Authority'),
    headerClassName: 'header',
    headerAlign: HEADER_ALIGN,
    flex: 1,
    align: 'left'
  },
  {
    field: 'speciesAuthority',
    headerName: 'Species Authority',
    renderHeader: () => formatHeader('Species', 'Authority'),
    headerClassName: 'header',
    headerAlign: HEADER_ALIGN,
    flex: 1,
    align: 'left'
  },
  {
    field: 'subspeciesAuthority',
    headerName: 'Subspecies Authority',
    renderHeader: () => formatHeader('Subspecies', 'Authority'),
    headerClassName: 'header',
    flex: 1,
    align: 'left'
  },
  {
    field: 'speciesIDLevel',
    headerName: 'Species ID Level',
    renderHeader: () => formatHeader('Species', 'ID Level'),
    headerClassName: 'header',
    headerAlign: HEADER_ALIGN,
    flex: 1,
    align: 'left'
  },
  {
    field: 'speciesFieldFamily',
    headerName: 'Species Field Family',
    renderHeader: () => formatHeader('Species', 'Field Family'),
    headerClassName: 'header',
    headerAlign: HEADER_ALIGN,
    flex: 1,
    align: 'left'
  }
];

// note --> originally attempted to use GridValueFormatterParams, but this isn't exported by MUI X DataGrid anymore. replaced with <any> for now.

const renderValueCell = (params: any, valueKey: string, unitKey: string) => {
  const value = params.row[valueKey] ? Number(params.row[valueKey]).toFixed(2) : 'null';
  const units = params.row[unitKey] ? (params.row[valueKey] !== null ? params.row[unitKey] : '') : '';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'row', gap: '0.5em', alignItems: 'center' }}>
      {value && <Typography level="body-sm">{value}</Typography>}
      {units && <Typography level="body-sm">{units}</Typography>}
    </Box>
  );
};

const renderEditValueCell = (params: any, valueKey: string, unitKey: string, placeholder: string) => {
  const apiRef = useGridApiRef();
  const { id, row } = params;
  const [error, setError] = useState(false);
  const [value, setValue] = useState(row[valueKey]);

  const handleValueChange = (event: any) => {
    const inputValue = event.target.value;
    const isValid = /^\d*\.?\d{0,2}$/.test(inputValue);
    setError(!isValid);
    if (isValid) {
      setValue(inputValue);
    }
  };

  const handleValueBlur = () => {
    const truncatedValue = Number(value).toFixed(2);
    apiRef.current.setEditCellValue({ id, field: valueKey, value: truncatedValue });
  };

  const handleUnitsChange = (_event: any, newValue: any) => {
    if (newValue !== null) {
      apiRef.current.setEditCellValue({ id, field: unitKey, value: newValue });
    }
  };

  useEffect(() => {
    setValue(row[valueKey]);
  }, [row[valueKey]]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'row', gap: '0.5em', alignItems: 'center' }}>
      <Stack direction="column">
        <Input
          value={value}
          onChange={handleValueChange}
          onBlur={handleValueBlur}
          error={error}
          placeholder={placeholder}
          required
          slotProps={{
            input: {
              'aria-invalid': error
            }
          }}
        />
        {error && (
          <FormHelperText>
            <Typography color="danger">Only numbers with up to 2 decimal places accepted!</Typography>
          </FormHelperText>
        )}
      </Stack>
      <Select value={row[unitKey]} onChange={handleUnitsChange} placeholder={'Units'} required>
        {unitSelectionOptions.map(option => (
          <Option key={option} value={option}>
            {option}
          </Option>
        ))}
      </Select>
    </Box>
  );
};

export const renderDBHCell = (params: any) => renderValueCell(params, 'measuredDBH', '');
export const renderEditDBHCell = (params: any) => renderEditValueCell(params, 'measuredDBH', '', 'Diameter at breast height (DBH)');
export const renderHOMCell = (params: any) => renderValueCell(params, 'measuredHOM', '');
export const renderEditHOMCell = (params: any) => renderEditValueCell(params, 'measuredHOM', '', 'Height of Measure (HOM)');
export const renderStemXCell = (params: any) => renderValueCell(params, 'localStemX', '');
export const renderEditStemXCell = (params: any) => renderEditValueCell(params, 'localStemX', '', 'Stem Local X Coordinates');
export const renderStemYCell = (params: any) => renderValueCell(params, 'localStemY', '');
export const renderEditStemYCell = (params: any) => renderEditValueCell(params, 'localStemY', '', 'Stem Local Y Coordinates');

export const MeasurementsSummaryViewGridColumns: GridColDef[] = [
  {
    field: 'id',
    headerName: 'ID',
    headerClassName: 'header',
    flex: 0.3,
    align: CELL_ALIGN,
    headerAlign: HEADER_ALIGN,
    editable: false
  },
  {
    field: 'coreMeasurementID',
    headerName: '#',
    headerAlign: HEADER_ALIGN,
    headerClassName: 'header',
    flex: 0.4,
    align: 'left'
  },
  {
    field: 'quadratName',
    headerName: 'Quadrat',
    renderHeader: () => formatHeader('Quadrat', 'Name'),
    headerAlign: HEADER_ALIGN,
    headerClassName: 'header',
    flex: 0.8,
    align: 'left',
    editable: true
  },
  {
    field: 'speciesID',
    headerName: 'Species ID',
    headerAlign: HEADER_ALIGN,
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    editable: true
  },
  {
    field: 'speciesCode',
    headerName: 'Species Code',
    renderHeader: () => formatHeader('Species', 'Code'),
    headerAlign: HEADER_ALIGN,
    headerClassName: 'header',
    flex: 1.2,
    align: 'left',
    editable: true
  },
  {
    field: 'treeID',
    headerName: 'Tree ID',
    headerAlign: HEADER_ALIGN,
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    editable: true
  },
  {
    field: 'treeTag',
    headerName: 'Tree',
    renderHeader: () => formatHeader('Tree', 'Tag'),
    headerAlign: HEADER_ALIGN,
    headerClassName: 'header',
    flex: 0.7,
    align: 'left',
    editable: true
  },
  {
    field: 'stemID',
    headerName: 'Stem ID',
    headerAlign: HEADER_ALIGN,
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    editable: true
  },
  {
    field: 'stemTag',
    headerName: 'Stem',
    renderHeader: () => formatHeader('Stem', 'Tag'),
    headerAlign: HEADER_ALIGN,
    headerClassName: 'header',
    flex: 0.7,
    align: 'left',
    editable: true
  },
  {
    field: 'stemLocalX',
    headerName: 'X',
    renderHeader: () => formatHeader('X', 'Stem'),
    headerAlign: HEADER_ALIGN,
    headerClassName: 'header',
    flex: 0.7,
    type: 'number',
    valueFormatter: (value: any) => {
      return Number(value).toFixed(2);
    },
    maxWidth: 100,
    align: 'left',
    renderCell: renderStemXCell,
    renderEditCell: renderEditStemXCell,
    editable: true
  },
  {
    field: 'stemLocalY',
    headerName: 'Y',
    renderHeader: () => formatHeader('Y', 'Stem'),
    headerAlign: HEADER_ALIGN,
    headerClassName: 'header',
    flex: 0.7,
    type: 'number',
    valueFormatter: (value: any) => {
      return Number(value).toFixed(2);
    },
    maxWidth: 100,
    align: 'left',
    renderCell: renderStemYCell,
    renderEditCell: renderEditStemYCell,
    editable: true
  },
  {
    field: 'measuredDBH',
    headerName: 'DBH',
    headerClassName: 'header',
    flex: 0.5,
    headerAlign: HEADER_ALIGN,
    align: CELL_ALIGN,
    editable: true,
    renderCell: renderDBHCell,
    renderEditCell: renderEditDBHCell
  },
  {
    field: 'measuredHOM',
    headerName: 'HOM',
    headerClassName: 'header',
    flex: 0.5,
    align: CELL_ALIGN,
    headerAlign: HEADER_ALIGN,
    editable: true,
    renderCell: renderHOMCell,
    renderEditCell: renderEditHOMCell
  },
  {
    field: 'description',
    headerName: 'Description',
    headerClassName: 'header',
    headerAlign: HEADER_ALIGN,
    flex: 0.6,
    align: 'left',
    editable: true
  },
  { field: 'attributes', headerName: 'Attributes', headerClassName: 'header', flex: 1, align: 'left', headerAlign: HEADER_ALIGN, editable: true }
];

export const StemGridColumns: GridColDef[] = [
  {
    field: 'id',
    headerName: '#',
    headerClassName: 'header',
    flex: 0.3,
    align: CELL_ALIGN,
    headerAlign: HEADER_ALIGN,
    editable: false
  },
  {
    field: 'stemTag',
    headerName: 'Stem Tag',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    headerAlign: HEADER_ALIGN,
    type: 'string',
    editable: true
  },
  {
    field: 'localX',
    headerName: 'Plot X',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    headerAlign: HEADER_ALIGN,
    type: 'number',
    valueFormatter: (value: any) => {
      return Number(value).toFixed(2);
    },
    editable: true
  },
  {
    field: 'localY',
    headerName: 'Plot Y',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    headerAlign: HEADER_ALIGN,
    type: 'number',
    valueFormatter: (value: any) => {
      return Number(value).toFixed(2);
    },
    editable: true
  },
  {
    field: 'moved',
    headerName: 'Moved',
    headerClassName: 'header',
    flex: 1,
    headerAlign: HEADER_ALIGN,
    align: 'left',
    type: 'boolean',
    editable: true
  },
  {
    field: 'stemDescription',
    headerName: 'StemDescription',
    headerClassName: 'header',
    flex: 1,
    headerAlign: HEADER_ALIGN,
    align: 'left',
    type: 'string',
    editable: true
  }
];

export const SpeciesLimitsGridColumns: GridColDef[] = [
  {
    field: 'id',
    headerName: '#',
    headerClassName: 'header',
    flex: 0.3,
    align: CELL_ALIGN,
    headerAlign: HEADER_ALIGN,
    editable: false
  },
  {
    field: 'speciesLimitID',
    headerName: '#',
    headerClassName: 'header',
    flex: 0.3,
    align: 'left',
    headerAlign: HEADER_ALIGN,
    editable: false
  },
  {
    field: 'speciesID',
    headerName: 'SpeciesID',
    headerClassName: 'header',
    flex: 0.3,
    align: 'left',
    headerAlign: HEADER_ALIGN,
    editable: false
  },
  {
    field: 'limitType',
    headerName: 'LimitType',
    renderHeader: () => formatHeader('Limit', 'Type'),
    flex: 0.5,
    align: 'left',
    headerAlign: HEADER_ALIGN,
    type: 'singleSelect',
    valueOptions: ['DBH', 'HOM'],
    editable: true
  },
  {
    field: 'lowerBound',
    headerName: 'LowerBound',
    renderHeader: () => formatHeader('Lower', 'Limit'),
    flex: 0.5,
    align: 'left',
    headerAlign: HEADER_ALIGN,
    type: 'number',
    editable: true
  },
  {
    field: 'upperBound',
    headerName: 'UpperBound',
    renderHeader: () => formatHeader('Upper', 'Limit'),
    flex: 0.5,
    align: 'left',
    headerAlign: HEADER_ALIGN,
    type: 'number',
    editable: true
  },
  {
    field: 'unit',
    headerName: 'Units',
    headerClassName: 'header',
    flex: 0.3,
    align: 'left',
    headerAlign: HEADER_ALIGN,
    type: 'singleSelect',
    valueOptions: unitSelectionOptions
  }
];

export const RolesGridColumns: GridColDef[] = [
  {
    field: 'id',
    headerName: '#',
    headerClassName: 'header',
    flex: 0.3,
    align: CELL_ALIGN,
    headerAlign: HEADER_ALIGN,
    editable: false
  },
  {
    field: 'roleID',
    headerName: '#',
    headerClassName: 'header',
    flex: 0.2,
    align: CELL_ALIGN,
    headerAlign: HEADER_ALIGN,
    editable: false
  },
  { field: 'roleName', headerName: 'Role', headerClassName: 'header', flex: 1, align: 'left', headerAlign: HEADER_ALIGN, editable: true },
  {
    field: 'roleDescription',
    headerName: 'Description',
    headerClassName: 'header',
    headerAlign: HEADER_ALIGN,
    flex: 1,
    align: 'left',
    editable: true
  }
];
// Combine the column definitions
const combineColumns = (primary: GridColDef[], secondary: GridColDef[]): GridColDef[] => {
  const combined = [...primary];

  secondary.forEach(secondaryColumn => {
    const primaryColumnIndex = primary.findIndex(primaryColumn => primaryColumn.field === secondaryColumn.field);
    if (primaryColumnIndex === -1) {
      combined.push(secondaryColumn);
    } else {
      // Merge columns if both contain renderHeader, otherwise preserve existing properties
      combined[primaryColumnIndex] = { ...combined[primaryColumnIndex], ...secondaryColumn };
    }
  });

  return combined;
};

const rawColumns: GridColDef[] = combineColumns(MeasurementsSummaryViewGridColumns, StemTaxonomiesViewGridColumns);

export const ViewFullTableGridColumns = rawColumns.map(column => {
  if (column.field === 'speciesCode') {
    return { ...column, renderHeader: () => formatHeader('Species', 'Code') };
  } else if (column.field === 'genusAuthority') {
    return { ...column, renderHeader: () => formatHeader('Genus', 'Authority') };
  } else if (column.field === 'speciesAuthority') {
    return { ...column, renderHeader: () => formatHeader('Species', 'Authority') };
  } else if (column.field === 'subspeciesAuthority') {
    return { ...column, renderHeader: () => formatHeader('Subspecies', 'Authority') };
  } else if (column.field === 'speciesIDLevel') {
    return { ...column, renderHeader: () => formatHeader('Species', 'ID Level') };
  } else if (column.field === 'speciesFieldFamily') {
    return { ...column, renderHeader: () => formatHeader('Species', 'Field Family') };
  }
  return column;
});

// FORM GRID COLUMNS
