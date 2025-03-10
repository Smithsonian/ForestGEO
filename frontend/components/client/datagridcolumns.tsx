import { HEADER_ALIGN } from '@/config/macros';
import { Autocomplete, Box, Chip, IconButton, Stack, Typography } from '@mui/joy';
import { GridColDef, GridPreProcessEditCellProps, GridRenderEditCellParams } from '@mui/x-data-grid';
import React, { Dispatch, SetStateAction, useState } from 'react';
import { AttributeStatusOptions } from '@/config/sqlrdsdefinitions/core';
import { standardizeGridColumns } from '@/components/client/clientmacros';
import { customNumericOperators } from '@/components/datagrids/filtrationsystem';
import CloseIcon from '@mui/icons-material/Close';

export const formatHeader = (word1: string, word2: string) => (
  <Stack direction={'column'} sx={{ width: '100%', alignItems: 'center', justifyContent: 'center' }}>
    <Typography level="body-sm" fontWeight={'bold'}>
      {word1}
    </Typography>
    <Typography level="body-xs">{word2}</Typography>
  </Stack>
);

export const QuadratGridColumns: GridColDef[] = standardizeGridColumns([
  {
    field: 'id',
    headerName: '#',
    flex: 0.3,
    editable: false,
    filterable: false
  },
  {
    field: 'quadratID',
    headerName: '#',
    flex: 0.3,
    editable: false,
    filterable: false
  },
  {
    field: 'quadratName',
    headerName: 'Quadrat Name',
    renderHeader: () => formatHeader('Quadrat', 'Name'),
    flex: 0.75,
    type: 'string',
    editable: true
  },
  {
    field: 'startX',
    headerName: 'X',
    flex: 0.5,
    type: 'number',
    valueFormatter: (value: any) => {
      return Number(value).toFixed(2);
    },
    editable: true
  },
  {
    field: 'startY',
    headerName: 'Y',
    flex: 0.5,
    type: 'number',
    valueFormatter: (value: any) => {
      return Number(value).toFixed(2);
    },
    editable: true,
    filterOperators: customNumericOperators
  },
  {
    field: 'area',
    headerName: 'Area',
    flex: 0.75,
    type: 'number',
    valueFormatter: (value: any) => {
      return Number(value).toFixed(2);
    },
    editable: true,
    filterOperators: customNumericOperators
  },
  {
    field: 'dimensionX',
    headerName: 'DimX',
    flex: 1,
    renderHeader: () => formatHeader('Dimension', 'X'),
    type: 'number',
    valueFormatter: (value: any) => {
      let parsedValue = Number(value);
      if (isNaN(value)) parsedValue = 0.0;
      return parsedValue.toFixed(2);
    },
    editable: true,
    filterOperators: customNumericOperators
  },
  {
    field: 'dimensionY',
    headerName: 'DimY',
    flex: 1,
    renderHeader: () => formatHeader('Dimension', 'Y'),
    type: 'number',
    valueFormatter: (value: any) => {
      let parsedValue = Number(value);
      if (isNaN(value)) parsedValue = 0.0;
      return parsedValue.toFixed(2);
    },
    editable: true,
    filterOperators: customNumericOperators
  },
  {
    field: 'quadratShape',
    headerName: 'Quadrat Shape',
    flex: 1,
    renderHeader: () => formatHeader('Quadrat', 'Shape'),
    type: 'string',
    editable: true
  }
]);

export const AttributeGridColumns: GridColDef[] = standardizeGridColumns([
  {
    field: 'id',
    headerName: '#',
    flex: 0.3,
    editable: false,
    filterable: false
  },
  { field: 'code', headerName: 'Code', headerClassName: 'header', minWidth: 150, flex: 1, editable: true }, // all unique ID columns need to be tagged 'id'
  {
    field: 'description',
    headerName: 'Description',
    minWidth: 250,
    flex: 1,
    editable: true
  },
  {
    field: 'status',
    headerName: 'Status',
    minWidth: 150,
    flex: 1,
    editable: true,
    type: 'singleSelect',
    valueOptions: AttributeStatusOptions
  }
]);

export const PersonnelGridColumns: GridColDef[] = standardizeGridColumns([
  {
    field: 'id',
    headerName: '#',
    flex: 0.3,
    editable: false,
    filterable: false
  },
  {
    field: 'personnelID',
    headerName: 'PersonnelID',
    flex: 1,
    editable: false,
    filterable: false
  },
  {
    field: 'censusID',
    headerName: 'Census ID',
    flex: 1,
    editable: true,
    filterable: false
  },
  {
    field: 'firstName',
    headerName: 'First Name',
    flex: 1,
    editable: true
  },
  {
    field: 'lastName',
    headerName: 'Last Name',
    flex: 1,
    editable: true
  }
]);

export const StemTaxonomiesViewGridColumns: GridColDef[] = standardizeGridColumns([
  {
    field: 'id',
    headerName: '#',
    flex: 0.3,
    editable: false,
    filterable: false
  },
  {
    field: 'stemID',
    headerName: '#',
    flex: 0.1,
    headerClassName: 'header',
    align: 'left',
    headerAlign: HEADER_ALIGN,
    filterable: false
  },
  { field: 'stemTag', headerName: 'Stem Tag', flex: 1, headerClassName: 'header', align: 'left', headerAlign: HEADER_ALIGN },
  {
    field: 'treeID',
    headerName: 'Tree ID',
    flex: 1,
    headerClassName: 'header',
    align: 'left',
    headerAlign: HEADER_ALIGN,
    filterable: false
  },
  { field: 'treeTag', headerName: 'Tree Tag', flex: 1, headerClassName: 'header', align: 'left', headerAlign: HEADER_ALIGN },
  {
    field: 'speciesID',
    headerName: 'Species ID',
    flex: 1,
    headerClassName: 'header',
    align: 'left',
    headerAlign: HEADER_ALIGN,
    filterable: false
  },
  {
    field: 'speciesCode',
    headerName: 'Species Code',
    renderHeader: () => formatHeader('Species', 'Code'),
    flex: 1
  },
  {
    field: 'familyID',
    headerName: 'Family ID',
    flex: 1,
    headerClassName: 'header',
    align: 'left',
    headerAlign: HEADER_ALIGN,
    filterable: false
  },
  { field: 'family', headerName: 'Family', flex: 1, headerClassName: 'header', align: 'left', headerAlign: HEADER_ALIGN },
  {
    field: 'genusID',
    headerName: 'Genus ID',
    flex: 1,
    headerClassName: 'header',
    align: 'left',
    headerAlign: HEADER_ALIGN,
    filterable: false
  },
  { field: 'genus', headerName: 'Genus', flex: 1, headerClassName: 'header', align: 'left', headerAlign: HEADER_ALIGN },
  { field: 'speciesName', headerName: 'Species', flex: 1, headerClassName: 'header', align: 'left', headerAlign: HEADER_ALIGN },
  { field: 'subspeciesName', headerName: 'Subspecies', flex: 1, headerClassName: 'header', align: 'left', headerAlign: HEADER_ALIGN },
  {
    field: 'genusAuthority',
    headerName: 'Genus Authority',
    renderHeader: () => formatHeader('Genus', 'Authority'),
    flex: 1
  },
  {
    field: 'speciesAuthority',
    headerName: 'Species Authority',
    renderHeader: () => formatHeader('Species', 'Authority'),
    flex: 1
  },
  {
    field: 'subspeciesAuthority',
    headerName: 'Subspecies Authority',
    renderHeader: () => formatHeader('Subspecies', 'Authority'),
    flex: 1
  },
  {
    field: 'speciesIDLevel',
    headerName: 'Species ID Level',
    renderHeader: () => formatHeader('Species', 'ID Level'),
    flex: 1
  },
  {
    field: 'speciesFieldFamily',
    headerName: 'Species Field Family',
    renderHeader: () => formatHeader('Species', 'Field Family'),
    flex: 1
  }
]);

// note --> originally attempted to use GridValueFormatterParams, but this isn't exported by MUI X DataGrid anymore. replaced with <any> for now.

// const renderValueCell = (params: any, valueKey: string, unitKey: string) => {
//   const value = params.row[valueKey] ? Number(params.row[valueKey]).toFixed(2) : 'null';
//   const units = params.row[unitKey] ? (params.row[valueKey] !== null ? params.row[unitKey] : '') : '';
//
//   return (
//     <Box sx={{ display: 'flex', flexDirection: 'row', gap: '0.5em', alignItems: 'center' }}>
//       {value && <Typography level="body-sm">{value}</Typography>}
//       {units && <Typography level="body-sm">{units}</Typography>}
//     </Box>
//   );
// };
//
// const renderEditValueCell = (params: any, valueKey: string, unitKey: string, placeholder: string) => {
//   const apiRef = useGridApiContext();
//   const { id, row } = params;
//   const [error, setError] = useState(false);
//   const [value, setValue] = useState(row[valueKey]);
//
//   const handleValueChange = (event: any) => {
//     const inputValue = event.target.value;
//     const isValid = /^\d*\.?\d{0,2}$/.test(inputValue);
//     setError(!isValid);
//     if (isValid) {
//       setValue(inputValue);
//     }
//   };
//
//   const handleValueBlur = () => {
//     const truncatedValue = Number(value).toFixed(2);
//     apiRef.current.setEditCellValue({ id, field: valueKey, value: truncatedValue });
//   };
//
//   const handleUnitsChange = (_event: any, newValue: any) => {
//     if (newValue !== null) {
//       apiRef.current.setEditCellValue({ id, field: unitKey, value: newValue });
//     }
//   };
//
//   useEffect(() => {
//     setValue(row[valueKey]);
//   }, [row[valueKey]]);
//
//   return (
//     <Box sx={{ display: 'flex', flexDirection: 'row', gap: '0.5em', alignItems: 'center' }}>
//       <Stack direction="column">
//         <Input
//           value={value}
//           onChange={handleValueChange}
//           onBlur={handleValueBlur}
//           error={error}
//           placeholder={placeholder}
//           required
//           slotProps={{
//             input: {
//               'aria-invalid': error
//             }
//           }}
//         />
//         {error && (
//           <FormHelperText>
//             <Typography color="danger">Only numbers with up to 2 decimal places accepted!</Typography>
//           </FormHelperText>
//         )}
//       </Stack>
//       <Select value={row[unitKey]} onChange={handleUnitsChange} placeholder={'Units'} required>
//         {unitSelectionOptions.map(option => (
//           <Option key={option} value={option}>
//             {option}
//           </Option>
//         ))}
//       </Select>
//     </Box>
//   );
// };
//
// export const renderDBHCell = (params: any) => renderValueCell(params, 'measuredDBH', '');
// export const renderEditDBHCell = (params: any) => renderEditValueCell(params, 'measuredDBH', '', 'Diameter at breast height (DBH)');
// export const renderHOMCell = (params: any) => renderValueCell(params, 'measuredHOM', '');
// export const renderEditHOMCell = (params: any) => renderEditValueCell(params, 'measuredHOM', '', 'Height of Measure (HOM)');
// export const renderStemXCell = (params: any) => renderValueCell(params, 'localStemX', '');
// export const renderEditStemXCell = (params: any) => renderEditValueCell(params, 'localStemX', '', 'Stem Local X Coordinates');
// export const renderStemYCell = (params: any) => renderValueCell(params, 'localStemY', '');
// export const renderEditStemYCell = (params: any) => renderEditValueCell(params, 'localStemY', '', 'Stem Local Y Coordinates');\

export function InputChip({
  params,
  selectableAttributes,
  setReloadAttributes
}: {
  params: GridRenderEditCellParams;
  selectableAttributes: string[];
  setReloadAttributes: Dispatch<SetStateAction<boolean>>;
}) {
  const [selectedValues, setSelectedValues] = useState<string[]>(params.value?.replace(/\s+/g, '').split(';') ?? []);

  const handleDelete = (valueToRemove: string) => {
    const updatedValues = selectedValues.filter(value => value !== valueToRemove);
    setSelectedValues(updatedValues);
    params.api.setEditCellValue({ id: params.id, field: 'attributes', value: updatedValues.join(';') });
    setReloadAttributes(true);
  };

  return (
    <Box sx={{ width: '100%', minHeight: '32px' }}>
      <Autocomplete
        multiple
        size="sm"
        options={selectableAttributes}
        autoHighlight
        autoComplete
        value={selectedValues}
        filterSelectedOptions
        onChange={(_, newValues) => {
          setSelectedValues(newValues);
          params.api.setEditCellValue({ id: params.id, field: 'attributes', value: newValues.join(';') });
          setReloadAttributes(true);
        }}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === 'Tab') {
            event.stopPropagation();
          }
        }}
        sx={{ width: '100%' }}
        renderTags={(values, getTagProps) =>
          values.map((option, index) => (
            <Chip
              {...getTagProps({ index })}
              key={index}
              size="sm"
              endDecorator={
                <IconButton onClick={() => handleDelete(option)} size="sm" sx={{ padding: 0 }}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              }
            >
              {option}
            </Chip>
          ))
        }
      />
    </Box>
  );
}

function preprocessor(params: GridPreProcessEditCellProps) {
  const { props } = params;
  let newValue = props.value;

  if (typeof newValue === 'string' && newValue.trim() !== '') {
    const parsedValue = parseFloat(newValue);
    if (!isNaN(parsedValue)) {
      newValue = parseFloat(parsedValue.toFixed(2));
    }
  }

  return { ...props, value: newValue };
}

export const MeasurementsSummaryViewGridColumns: GridColDef[] = standardizeGridColumns([
  {
    field: 'id',
    headerName: 'ID',
    flex: 0.3,
    editable: false,
    filterable: false
  },
  {
    field: 'coreMeasurementID',
    headerName: '#',
    flex: 0.4,
    filterable: false
  },
  {
    field: 'quadratName',
    headerName: 'Quadrat',
    renderHeader: () => formatHeader('Quadrat', 'Name'),
    flex: 0.8,
    editable: true
  },
  {
    field: 'speciesID',
    headerName: 'Species ID',
    flex: 1,
    editable: true,
    filterable: false
  },
  {
    field: 'speciesCode',
    headerName: 'Species Code',
    renderHeader: () => formatHeader('Species', 'Code'),
    flex: 1.2,
    editable: true
  },
  {
    field: 'treeID',
    headerName: 'Tree ID',
    flex: 1,
    editable: true,
    filterable: false
  },
  {
    field: 'treeTag',
    headerName: 'Tree',
    renderHeader: () => formatHeader('Tree', 'Tag'),
    flex: 0.7,
    editable: true
  },
  {
    field: 'stemID',
    headerName: 'Stem ID',
    flex: 1,
    editable: true,
    filterable: false
  },
  {
    field: 'stemTag',
    headerName: 'Stem',
    renderHeader: () => formatHeader('Stem', 'Tag'),
    flex: 0.7,
    editable: true
  },
  {
    field: 'localX',
    headerName: 'X',
    renderHeader: () => formatHeader('X', 'Stem'),
    flex: 0.7,
    valueFormatter: (value: any) => {
      return Number(value).toFixed(2);
    },
    maxWidth: 100,
    editable: true,
    type: 'number',
    preProcessEditCellProps: params => preprocessor(params)
  },
  {
    field: 'localY',
    headerName: 'Y',
    renderHeader: () => formatHeader('Y', 'Stem'),
    flex: 0.7,
    type: 'number',
    maxWidth: 100,
    valueFormatter: (value: any) => {
      return Number(value).toFixed(2);
    },
    editable: true,
    filterOperators: customNumericOperators,
    preProcessEditCellProps: params => preprocessor(params)
  },
  {
    field: 'measuredDBH',
    headerName: 'DBH',
    flex: 0.5,
    editable: true,
    valueFormatter: (value: any) => parseFloat(Number(value).toFixed(2)),
    filterOperators: customNumericOperators,
    preProcessEditCellProps: params => preprocessor(params),
    type: 'number'
  },
  {
    field: 'measuredHOM',
    headerName: 'HOM',
    flex: 0.5,
    editable: true,
    valueFormatter: (value: any) => {
      return Number(value).toFixed(2);
    },
    type: 'number',
    filterOperators: customNumericOperators,
    preProcessEditCellProps: params => preprocessor(params)
  },
  {
    field: 'description',
    headerName: 'Description',
    flex: 0.6,
    editable: true
  },
  { field: 'attributes', headerName: 'Attributes', flex: 1, editable: true }
]);

export const StemGridColumns: GridColDef[] = standardizeGridColumns([
  {
    field: 'id',
    headerName: '#',
    flex: 0.3,
    editable: false,
    filterable: false
  },
  {
    field: 'stemTag',
    headerName: 'Stem Tag',
    flex: 1,
    type: 'string',
    editable: true
  },
  {
    field: 'localX',
    headerName: 'Plot X',
    flex: 1,
    type: 'number',
    valueFormatter: (value: any) => {
      return Number(value).toFixed(2);
    },
    editable: true
  },
  {
    field: 'localY',
    headerName: 'Plot Y',
    flex: 1,
    type: 'number',
    valueFormatter: (value: any) => {
      return Number(value).toFixed(2);
    },
    editable: true
  },
  {
    field: 'moved',
    headerName: 'Moved',
    flex: 1,
    type: 'boolean',
    editable: true
  },
  {
    field: 'stemDescription',
    headerName: 'StemDescription',
    flex: 1,
    type: 'string',
    editable: true
  }
]);

export const SpeciesLimitsGridColumns: GridColDef[] = standardizeGridColumns([
  {
    field: 'id',
    headerName: '#',
    flex: 0.3,
    editable: false
  },
  {
    field: 'speciesLimitID',
    headerName: '#',
    flex: 0.3,
    editable: false
  },
  {
    field: 'speciesID',
    headerName: 'SpeciesID',
    flex: 0.3,
    editable: false
  },
  {
    field: 'limitType',
    headerName: 'LimitType',
    renderHeader: () => formatHeader('Limit', 'Type'),
    flex: 0.5,
    type: 'singleSelect',
    valueOptions: ['DBH', 'HOM'],
    editable: true
  },
  {
    field: 'lowerBound',
    headerName: 'LowerBound',
    renderHeader: () => formatHeader('Lower', 'Limit'),
    flex: 0.5,
    type: 'number',
    editable: true
  },
  {
    field: 'upperBound',
    headerName: 'UpperBound',
    renderHeader: () => formatHeader('Upper', 'Limit'),
    flex: 0.5,
    type: 'number',
    editable: true
  }
]);

export const RolesGridColumns: GridColDef[] = standardizeGridColumns([
  {
    field: 'id',
    headerName: '#',
    flex: 0.3,
    editable: false,
    filterable: false
  },
  {
    field: 'roleID',
    headerName: '#',
    flex: 0.2,
    editable: false,
    filterable: false
  },
  { field: 'roleName', headerName: 'Role', flex: 1, editable: true },
  {
    field: 'roleDescription',
    headerName: 'Description',
    flex: 1,
    editable: true
  }
]);
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

function formatValue(value: any): React.ReactNode {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch (error) {
      return '[Circular Object]';
    }
  }
  return value.toString();
}

export const UnifiedChangelogGridColumns: GridColDef[] = standardizeGridColumns([
  {
    field: 'id',
    headerName: '#',
    flex: 1,
    editable: false,
    filterable: false
  },
  {
    field: 'changeID',
    headerName: '#',
    flex: 1,
    editable: false,
    filterable: false
  },
  {
    field: 'tableName',
    headerName: 'Table',
    flex: 0.5,
    editable: false
  },
  {
    field: 'recordID',
    headerName: 'Record',
    flex: 0.5,
    editable: false,
    filterable: false
  },
  {
    field: 'operation',
    headerName: 'Op',
    flex: 0.3,
    editable: false
  },
  {
    field: 'oldRowState',
    headerName: 'Old',
    flex: 1,
    editable: false,
    renderCell: params => {
      const jsonData = params.row['oldRowState'];

      return (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: 'neutral.softBg',
            borderRadius: '8px',
            padding: '8px',
            maxHeight: '150px',
            overflow: 'auto',
            fontSize: '12px'
          }}
        >
          {jsonData && Object.keys(jsonData).length > 0 ? (
            Object.entries(jsonData).map(([key, value]) => (
              <Stack direction={'row'} key={key}>
                <Typography level={'body-md'}>
                  <strong>{key}</strong>:{formatValue(value)}
                </Typography>
              </Stack>
            ))
          ) : (
            <Typography level={'body-sm'} fontWeight={'bold'}>
              No previous data available
            </Typography>
          )}
        </Box>
      );
    }
  },
  {
    field: 'newRowState',
    headerName: 'New',
    flex: 1,
    editable: false,
    renderCell: params => {
      const jsonData = params.row['newRowState'];

      return (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: 'neutral.softBg',
            borderRadius: '8px',
            padding: '8px',
            maxHeight: '150px',
            overflow: 'auto',
            fontSize: '12px'
          }}
        >
          {jsonData && Object.keys(jsonData).length > 0 ? (
            Object.entries(jsonData).map(([key, value]) => (
              <Stack direction={'row'} key={key}>
                <Typography level={'body-md'}>
                  <strong>{key}</strong>:{formatValue(value)}
                </Typography>
              </Stack>
            ))
          ) : (
            <Typography level={'body-sm'} fontWeight={'bold'}>
              No previous data available
            </Typography>
          )}
        </Box>
      );
    }
  },
  {
    field: 'changeTimestamp',
    headerName: 'Change Time',
    flex: 0.5,
    editable: false
  },
  {
    field: 'changedBy',
    headerName: 'Changed By',
    flex: 0.5,
    editable: false
  }
]);
