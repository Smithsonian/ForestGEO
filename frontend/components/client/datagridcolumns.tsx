import { areaSelectionOptions, unitSelectionOptions } from '@/config/macros';
import { Box, FormHelperText, Input, Option, Select, Stack, Typography } from '@mui/joy';
import { GridColDef, GridRenderEditCellParams, useGridApiRef } from '@mui/x-data-grid';
import React, { useEffect, useState } from 'react';
import { AttributeStatusOptions } from '@/config/sqlrdsdefinitions/core';

export const formatHeader = (word1: string, word2: string) => (
  <Stack direction={'column'} sx={{ alignItems: 'center', justifyContent: 'center' }}>
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
    align: 'right',
    headerAlign: 'right',
    editable: false
  },
  {
    field: 'quadratID',
    headerName: '#',
    headerClassName: 'header',
    flex: 0.3,
    align: 'right',
    headerAlign: 'right',
    editable: false
  },
  {
    field: 'quadratName',
    headerName: 'Quadrat Name',
    headerClassName: 'header',
    renderHeader: () => formatHeader('Quadrat', 'Name'),
    flex: 0.75,
    align: 'right',
    headerAlign: 'right',
    type: 'string',
    editable: true
  },
  {
    field: 'startX',
    headerName: 'X',
    headerClassName: 'header',
    flex: 0.5,
    align: 'right',
    headerAlign: 'right',
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
    align: 'right',
    headerAlign: 'right',
    type: 'number',
    valueFormatter: (value: any) => {
      return Number(value).toFixed(2);
    },
    editable: true
  },
  {
    field: 'coordinateUnits',
    headerName: 'Coordinate Units',
    headerClassName: 'header',
    flex: 1,
    align: 'right',
    headerAlign: 'right',
    editable: true,
    type: 'singleSelect',
    valueOptions: unitSelectionOptions
  },
  {
    field: 'area',
    headerName: 'Area',
    headerClassName: 'header',
    flex: 0.75,
    align: 'right',
    headerAlign: 'right',
    type: 'number',
    valueFormatter: (value: any) => {
      return Number(value).toFixed(2);
    },
    editable: true
  },
  {
    field: 'areaUnits',
    headerName: 'Area Unit',
    headerClassName: 'header',
    flex: 1,
    align: 'right',
    headerAlign: 'right',
    editable: true,
    type: 'singleSelect',
    valueOptions: areaSelectionOptions
  },
  {
    field: 'dimensionX',
    headerName: 'DimX',
    headerClassName: 'header',
    flex: 1,
    renderHeader: () => formatHeader('Dimension', 'X'),
    align: 'right',
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
    align: 'right',
    headerAlign: 'right',
    type: 'number',
    valueFormatter: (value: any) => {
      let parsedValue = Number(value);
      if (isNaN(value)) parsedValue = 0.0;
      return parsedValue.toFixed(2);
    },
    editable: true
  },
  {
    field: 'dimensionUnits',
    headerName: 'Dimension Unit',
    headerClassName: 'header',
    flex: 1,
    renderHeader: () => formatHeader('Dimension', 'Unit'),
    align: 'right',
    headerAlign: 'right',
    editable: true,
    type: 'singleSelect',
    valueOptions: unitSelectionOptions
  },
  {
    field: 'quadratShape',
    headerName: 'Quadrat Shape',
    headerClassName: 'header',
    flex: 1,
    renderHeader: () => formatHeader('Quadrat', 'Shape'),
    align: 'right',
    headerAlign: 'right',
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
    align: 'right',
    headerAlign: 'right',
    editable: false
  },
  { field: 'code', headerName: 'Code', headerClassName: 'header', minWidth: 150, flex: 1, editable: true }, // all unique ID columns need to be tagged 'id'
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
    align: 'right',
    headerAlign: 'right',
    editable: false
  },
  {
    field: 'personnelID',
    headerName: 'PersonnelID',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    editable: false
  },
  {
    field: 'censusID',
    headerName: 'Census ID',
    headerAlign: 'left',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    editable: true
  },
  {
    field: 'firstName',
    headerName: 'First Name',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    editable: true
  },
  {
    field: 'lastName',
    headerName: 'Last Name',
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
    align: 'right',
    headerAlign: 'right',
    editable: false
  },
  { field: 'stemID', headerName: '#', headerClassName: 'header', flex: 0.1, align: 'left' },
  { field: 'stemTag', headerName: 'Stem', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'treeID', headerName: 'Tree ID', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'treeTag', headerName: 'Tree', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'speciesID', headerName: 'Species ID', headerClassName: 'header', flex: 1, align: 'left' },
  {
    field: 'speciesCode',
    headerName: 'Species Code',
    renderHeader: () => formatHeader('Species', 'Code'),
    headerClassName: 'header',
    flex: 1,
    align: 'left'
  },
  { field: 'familyID', headerName: 'Family ID', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'family', headerName: 'Family', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'genusID', headerName: 'Genus ID', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'genus', headerName: 'Genus', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'speciesName', headerName: 'Species', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'subspeciesName', headerName: 'Subspecies', headerClassName: 'header', flex: 1, align: 'left' },
  {
    field: 'genusAuthority',
    headerName: 'Genus Authority',
    renderHeader: () => formatHeader('Genus', 'Authority'),
    headerClassName: 'header',
    flex: 1,
    align: 'left'
  },
  {
    field: 'speciesAuthority',
    headerName: 'Species Authority',
    renderHeader: () => formatHeader('Species', 'Authority'),
    headerClassName: 'header',
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
    flex: 1,
    align: 'left'
  },
  {
    field: 'speciesFieldFamily',
    headerName: 'Species Field Family',
    renderHeader: () => formatHeader('Species', 'Field Family'),
    headerClassName: 'header',
    flex: 1,
    align: 'left'
  }
];

// note --> originally attempted to use GridValueFormatterParams, but this isn't exported by MUI X DataGrid anymore. replaced with <any> for now.

const renderDBHCell = (params: GridRenderEditCellParams) => {
  const value = params.row.measuredDBH ? Number(params.row.measuredDBH).toFixed(2) : 'null';
  const units = params.row.dbhUnits || '';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'row', gap: '0.5em', alignItems: 'center' }}>
      <Typography level="body-sm">{value}</Typography>
      <Typography level="body-sm">{units}</Typography>
    </Box>
  );
};

const renderEditDBHCell = (params: GridRenderEditCellParams) => {
  const apiRef = useGridApiRef();
  const { id, row } = params;
  const [error, setError] = useState(false);
  const [value, setValue] = useState(row.measuredDBH);

  const handleValueChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = event.target.value;
    const isValid = /^\d*\.?\d{0,2}$/.test(inputValue);
    setError(!isValid);
    if (isValid) {
      setValue(inputValue);
    }
  };

  const handleValueBlur = () => {
    const truncatedValue = Number(value).toFixed(2);
    apiRef.current.setEditCellValue({ id, field: 'measuredDBH', value: truncatedValue });
  };

  const handleUnitsChange = (_event: React.SyntheticEvent | null, newValue: string | null) => {
    if (newValue !== null) {
      apiRef.current.setEditCellValue({ id, field: 'dbhUnits', value: newValue });
    }
  };

  useEffect(() => {
    setValue(row.measuredDBH);
  }, [row.measuredDBH]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'row', gap: '0.5em', alignItems: 'center' }}>
      <Stack direction="column">
        <Input
          value={value}
          onChange={handleValueChange}
          onBlur={handleValueBlur}
          error={error}
          placeholder="Diameter at breast height (DBH)"
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
      <Select value={row.dbhUnits} onChange={handleUnitsChange} placeholder={'Units'} required>
        {unitSelectionOptions.map(option => (
          <Option key={option} value={option}>
            {option}
          </Option>
        ))}
      </Select>
    </Box>
  );
};

const renderHOMCell = (params: GridRenderEditCellParams) => {
  const value = params.row.measuredHOM ? Number(params.row.measuredHOM).toFixed(2) : 'null';
  const units = params.row.homUnits || '';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'row', gap: '0.5em', alignItems: 'center' }}>
      <Typography level="body-sm">{value}</Typography>
      <Typography level="body-sm">{units}</Typography>
    </Box>
  );
};

const renderEditHOMCell = (params: GridRenderEditCellParams) => {
  const apiRef = useGridApiRef();
  const { id, row } = params;
  const [error, setError] = useState(false);
  const [value, setValue] = useState(row.measuredHOM);

  const handleValueChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = event.target.value;
    const isValid = /^\d*\.?\d{0,2}$/.test(inputValue);
    setError(!isValid);
    if (isValid) {
      setValue(inputValue);
    }
  };

  const handleValueBlur = () => {
    const truncatedValue = Number(value).toFixed(2);
    apiRef.current.setEditCellValue({ id, field: 'measuredHOM', value: truncatedValue });
  };

  const handleUnitsChange = (_event: React.SyntheticEvent | null, newValue: string | null) => {
    if (newValue !== null) {
      apiRef.current.setEditCellValue({ id, field: 'homUnits', value: newValue });
    }
  };

  useEffect(() => {
    setValue(row.measuredHOM);
  }, [row.measuredHOM]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'row', gap: '0.5em', alignItems: 'center' }}>
      <Stack direction="column">
        <Input
          value={value}
          onChange={handleValueChange}
          onBlur={handleValueBlur}
          error={error}
          placeholder="Height of Measure (HOM)"
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
      <Select value={row.homUnits} onChange={handleUnitsChange} placeholder={'Units'} required>
        {unitSelectionOptions.map(option => (
          <Option key={option} value={option}>
            {option}
          </Option>
        ))}
      </Select>
    </Box>
  );
};

export const MeasurementsSummaryViewGridColumns: GridColDef[] = [
  {
    field: 'id',
    headerName: 'ID',
    headerClassName: 'header',
    flex: 0.3,
    align: 'right',
    headerAlign: 'right',
    editable: false
  },
  {
    field: 'coreMeasurementID',
    headerName: '#',
    headerAlign: 'left',
    headerClassName: 'header',
    flex: 0.4,
    align: 'left'
  },
  {
    field: 'quadratName',
    headerName: 'Quadrat',
    headerAlign: 'left',
    headerClassName: 'header',
    flex: 0.8,
    align: 'left',
    editable: true
  },
  {
    field: 'speciesID',
    headerName: 'Species ID',
    headerAlign: 'left',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    editable: true
  },
  {
    field: 'speciesCode',
    headerName: 'Species Code',
    headerAlign: 'left',
    headerClassName: 'header',
    flex: 1.2,
    align: 'left',
    editable: true
  },
  {
    field: 'treeID',
    headerName: 'Tree ID',
    headerAlign: 'left',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    editable: true
  },
  {
    field: 'treeTag',
    headerName: 'Tree',
    headerAlign: 'left',
    headerClassName: 'header',
    flex: 0.7,
    align: 'left',
    editable: true
  },
  {
    field: 'stemID',
    headerName: 'Stem ID',
    headerAlign: 'left',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    editable: true
  },
  {
    field: 'stemTag',
    headerName: 'Stem',
    headerAlign: 'left',
    headerClassName: 'header',
    flex: 0.7,
    align: 'left',
    editable: true
  },
  {
    field: 'stemLocalX',
    headerName: 'X',
    headerAlign: 'left',
    headerClassName: 'header',
    flex: 0.7,
    type: 'number',
    valueFormatter: (value: any) => {
      return Number(value).toFixed(2);
    },
    maxWidth: 100,
    align: 'left',
    editable: true
  },
  {
    field: 'stemLocalY',
    headerName: 'Y',
    headerAlign: 'left',
    headerClassName: 'header',
    flex: 0.7,
    type: 'number',
    valueFormatter: (value: any) => {
      return Number(value).toFixed(2);
    },
    maxWidth: 100,
    align: 'left',
    editable: true
  },
  {
    field: 'stemUnits',
    headerName: 'Stem Units',
    headerClassName: 'header',
    flex: 0.4,
    maxWidth: 65,
    renderHeader: () => formatHeader('Stem', 'Units'),
    align: 'center',
    editable: true,
    type: 'singleSelect',
    valueOptions: unitSelectionOptions
  },
  {
    field: 'measuredDBH',
    headerName: 'DBH',
    headerClassName: 'header',
    flex: 0.8,
    align: 'right',
    editable: true,
    renderCell: renderDBHCell,
    renderEditCell: renderEditDBHCell
  },
  {
    field: 'measuredHOM',
    headerName: 'HOM',
    headerClassName: 'header',
    flex: 0.5,
    align: 'right',
    headerAlign: 'left',
    editable: true,
    renderCell: renderHOMCell,
    renderEditCell: renderEditHOMCell
  },
  {
    field: 'description',
    headerName: 'Description',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    editable: true
  },
  { field: 'attributes', headerName: 'Attributes', headerClassName: 'header', flex: 1, align: 'left', editable: true }
];

export const StemGridColumns: GridColDef[] = [
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
    field: 'stemTag',
    headerName: 'Stem Tag',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    type: 'string',
    editable: true
  },
  {
    field: 'localX',
    headerName: 'Plot X',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
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
    type: 'number',
    valueFormatter: (value: any) => {
      return Number(value).toFixed(2);
    },
    editable: true
  },
  {
    field: 'coordinateUnits',
    headerName: 'Unit',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    type: 'singleSelect',
    valueOptions: unitSelectionOptions,
    editable: true
  },
  {
    field: 'moved',
    headerName: 'Moved',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    type: 'boolean',
    editable: true
  },
  {
    field: 'stemDescription',
    headerName: 'StemDescription',
    headerClassName: 'header',
    flex: 1,
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
    align: 'right',
    headerAlign: 'right',
    editable: false
  },
  {
    field: 'speciesLimitID',
    headerName: '#',
    headerClassName: 'header',
    flex: 0.3,
    align: 'left',
    headerAlign: 'left',
    editable: false
  },
  {
    field: 'speciesID',
    headerName: 'SpeciesID',
    headerClassName: 'header',
    flex: 0.3,
    align: 'left',
    headerAlign: 'left',
    editable: false
  },
  {
    field: 'limitType',
    headerName: 'LimitType',
    renderHeader: () => formatHeader('Limit', 'Type'),
    flex: 0.5,
    align: 'left',
    headerAlign: 'left',
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
    headerAlign: 'left',
    type: 'number',
    editable: true
  },
  {
    field: 'upperBound',
    headerName: 'UpperBound',
    renderHeader: () => formatHeader('Upper', 'Limit'),
    flex: 0.5,
    align: 'left',
    headerAlign: 'left',
    type: 'number',
    editable: true
  },
  {
    field: 'unit',
    headerName: 'Units',
    headerClassName: 'header',
    flex: 0.3,
    align: 'left',
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
    align: 'right',
    headerAlign: 'right',
    editable: false
  },
  {
    field: 'roleID',
    headerName: '#',
    headerClassName: 'header',
    flex: 0.2,
    align: 'right',
    headerAlign: 'right',
    editable: false
  },
  { field: 'roleName', headerName: 'Role', headerClassName: 'header', flex: 1, align: 'left', editable: true },
  {
    field: 'roleDescription',
    headerName: 'Description',
    headerClassName: 'header',
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
  } else if (column.field === 'stemUnits') {
    return { ...column, renderHeader: () => formatHeader('Stem', 'Units') };
  } else if (column.field === 'dbhUnits') {
    return { ...column, renderHeader: () => formatHeader('DBH', 'Units') };
  } else if (column.field === 'homUnits') {
    return { ...column, renderHeader: () => formatHeader('HOM', 'Units') };
  }
  return column;
});
