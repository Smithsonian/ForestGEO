'use client';
import React, { useEffect, useState } from 'react';
import { DataGrid, GridColDef, GridRowModel } from '@mui/x-data-grid';
import moment from 'moment';
import {
  Box,
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormLabel,
  Input,
  Modal,
  ModalDialog,
  Option,
  Select,
  Stack,
  Typography
} from '@mui/joy';
import { DatePicker } from '@mui/x-date-pickers';
import { areaSelectionOptions, unitSelectionOptions } from '@/config/macros';
import { useOrgCensusContext, usePlotContext } from '@/app/contexts/userselectionprovider';

interface ReEnterDataModalProps {
  row: GridRowModel;
  reEnterData: GridRowModel | null;
  handleClose: () => void;
  handleSave: (selectedRow: GridRowModel) => void;
  columns: GridColDef[];
  selectionOptions?: { value: string | number; label: string }[];
  clusters?: Record<string, string[]>; // New clusters prop for field grouping
  hiddenColumns?: Record<string, boolean>;
}

const ReEnterDataModal: React.FC<ReEnterDataModalProps> = ({
  row,
  reEnterData,
  handleClose,
  handleSave,
  columns,
  selectionOptions,
  clusters,
  hiddenColumns
}) => {
  const [localData, setLocalData] = useState<GridRowModel>({ ...reEnterData });
  const [selectedRow, setSelectedRow] = useState<GridRowModel | null>(null);
  const [isConfirmStep, setIsConfirmStep] = useState(false);
  const [isRowSelected, setIsRowSelected] = useState(false);

  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();

  useEffect(() => {
    if (reEnterData) {
      const initialData = { ...row };
      columns.forEach(column => {
        const { field, editable } = column;
        if (
          editable &&
          initialData[field] !== localData[field] &&
          initialData[field] !== '' &&
          initialData[field] !== null &&
          initialData[field] !== undefined
        ) {
          initialData[field] = '';
        }
      });
      setLocalData({ ...initialData });
    }
  }, [row, reEnterData, columns]);

  const normalizeRowData = (row: GridRowModel): GridRowModel => {
    return Object.keys(row).reduce((acc, key) => {
      const value = row[key];
      const column = columns.find(col => col.field === key);

      // If column is not found or field is non-editable, skip processing this field
      if (!column || !column.editable) {
        acc[key] = value;
        return acc;
      }

      // Handle specific fields like PlotID, CensusID that should not be normalized to empty or default
      if (key === 'plotID' || key === 'censusID') {
        // Keep PlotID and CensusID intact or use the default context values
        acc[key] = value !== null && value !== undefined ? value : key === 'plotID' ? currentPlot?.plotID : currentCensus?.dateRanges[0]?.censusID;
      }
      // Handle normal cases for null/undefined values or fields that require normalization
      else if (value === null || value === undefined) {
        if (column.type === 'number') {
          acc[key] = 0; // Normalize numbers to 0
        } else if (column.type === 'date') {
          acc[key] = null; // Normalize date fields to null
        } else if (column.type === 'singleSelect') {
          const fieldSelectionOptions = getFieldSelectionOptions(key) as string[];
          if (fieldSelectionOptions.includes('m')) {
            acc[key] = 'm'; // Default unit for specific fields
          } else if (fieldSelectionOptions.includes('m2')) {
            acc[key] = 'm2'; // Default area unit
          } else {
            acc[key] = ''; // Default to empty string for other single select fields
          }
        } else {
          acc[key] = ''; // Default to empty string for other cases
        }
      } else {
        // Keep valid values as they are
        acc[key] = value;
      }

      return acc;
    }, {} as GridRowModel);
  };

  const handleInputChange = (field: string, value: any) => {
    setLocalData(prevData => ({
      ...prevData,
      [field]: value === null || value === undefined ? '' : value
    }));
  };

  const handleConfirm = () => {
    setIsConfirmStep(true);
  };

  const handleRowSelect = (row: GridRowModel) => {
    setSelectedRow(row);
    setIsRowSelected(true);
  };

  const handleFinalConfirm = () => {
    if (selectedRow) {
      const { label, ...remaining } = selectedRow;
      console.log('selectedRow: ', selectedRow);
      const normalizedData = normalizeRowData(remaining);
      console.log('normalized row: ', normalizedData);
      handleSave(normalizedData);
    }
  };

  const getOptionLabel = (_field: string, value: any) => {
    if (selectionOptions) {
      const option = selectionOptions.find(opt => opt.value === value);
      return option ? option.label : value;
    }
    return value;
  };

  const getFieldSelectionOptions = (field: string) => {
    const fieldLower = field.toLowerCase();
    if ((fieldLower.includes('coordinate') || fieldLower.includes('dimension')) && fieldLower.includes('units')) {
      return unitSelectionOptions;
    }
    if (fieldLower.includes('area') && fieldLower.includes('units')) {
      return areaSelectionOptions;
    }
    return selectionOptions || [];
  };

  const renderFormFields = (fields: string[]) =>
    fields.map(field => {
      const column = columns.find(col => col.field === field);
      if (!column || !column.editable) return null;

      const { headerName, type } = column;
      const value = localData[field];
      const fieldOptions = getFieldSelectionOptions(field);

      if (type === 'singleSelect') {
        return (
          <FormControl key={field} sx={{ minWidth: 200 }}>
            <FormLabel>{headerName}</FormLabel>
            <Select placeholder={headerName} value={value} onChange={(_, newValue) => handleInputChange(field, newValue)}>
              {fieldOptions?.map(option => {
                if (typeof option === 'object' && 'value' in option && 'label' in option) {
                  return (
                    <Option key={option.value} value={option.value}>
                      {option.label}
                    </Option>
                  );
                } else {
                  return (
                    <Option key={option} value={option}>
                      {option}
                    </Option>
                  );
                }
              })}
            </Select>
          </FormControl>
        );
      }

      if (type === 'date') {
        return (
          <FormControl key={field} sx={{ minWidth: 200 }}>
            <FormLabel>{headerName}</FormLabel>
            <DatePicker
              label={headerName}
              value={value ? moment(value).utc() : null}
              onChange={newValue => handleInputChange(field, moment(newValue).utc().format('YYYY-MM-DD'))}
            />
          </FormControl>
        );
      }

      return (
        <FormControl key={field} sx={{ minWidth: 200 }}>
          <FormLabel>{headerName}</FormLabel>
          <Input placeholder={headerName} value={value} onChange={e => handleInputChange(field, e.target.value)} fullWidth />
        </FormControl>
      );
    });

  const filteredColumns = columns.filter(column => !hiddenColumns?.[column.field] && !column.field.includes('ID'));

  const rowsData = [
    row ? { ...row, id: 'starter', label: 'Original' } : null,
    reEnterData ? { ...reEnterData, id: 'original', label: 'First Modification' } : null,
    localData ? { ...localData, id: 'modified', label: 'Second Modification (Re-entry)' } : null
  ].filter(rowItem => rowItem && rowItem.id); // Filter out rows without an ID

  useEffect(() => {
    console.log('reEnterData:', reEnterData);
    console.log('localData:', localData);
  }, [reEnterData, localData]);

  return (
    <Modal open onClose={handleClose}>
      <ModalDialog variant="outlined" sx={{ maxWidth: '90vw', overflow: 'auto' }}>
        <DialogTitle>Re-Enter Data</DialogTitle>
        <DialogContent>
          {!isConfirmStep ? (
            <>
              {clusters &&
                Object.entries(clusters).map(([clusterName, fields]) => (
                  <Box key={clusterName} sx={{ marginBottom: 4 }}>
                    <Typography level="body-lg" sx={{ marginBottom: 1 }}>
                      {clusterName}
                    </Typography>
                    <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
                      {renderFormFields(fields)}
                    </Stack>
                  </Box>
                ))}
            </>
          ) : (
            <Box className="mt-4" sx={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
              <Typography level="title-lg">Please choose from the following -- </Typography>
              <Typography level="body-md">
                1. <b>Original</b> -- ignore all modifications made to the row.
              </Typography>
              <Typography level="body-md">
                2. <b>First Modification</b> -- proceed with the initial change you made.
              </Typography>
              <Typography level="body-md" sx={{ marginBottom: 2 }}>
                3. <b>Second Modification</b> -- the initial change contained a type, proceed with the re-entered version.
              </Typography>
              <Box sx={{ display: 'flex', flex: 1, width: '100%' }}>
                <DataGrid
                  rows={rowsData}
                  columns={[
                    {
                      field: 'label',
                      headerName: 'Row',
                      width: 300,
                      renderCell: params => (
                        <Typography level="body-md" sx={{ fontWeight: 'bold' }}>
                          {params.value}
                        </Typography>
                      )
                    },
                    ...filteredColumns.map(col => ({
                      ...col,
                      flex: col.flex || 1,
                      minWidth: col.minWidth || 150,
                      renderCell: (params: any) => {
                        const value = params.value;
                        const displayValue = typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
                        return (
                          <Box
                            sx={{
                              whiteSpace: 'normal',
                              wordWrap: 'break-word',
                              width: '100%'
                            }}
                          >
                            {selectionOptions && col.type === 'singleSelect' ? getOptionLabel(col.field, displayValue) : displayValue}
                          </Box>
                        );
                      }
                    }))
                  ]}
                  getRowId={row => row.id}
                  onRowClick={params => handleRowSelect(params.row)}
                  sx={{
                    display: 'flex',
                    flex: 1,
                    width: '100%',
                    '& .MuiDataGrid-row': {
                      cursor: 'pointer'
                    },
                    '& .MuiDataGrid-row:hover': {
                      backgroundColor: 'rgba(0, 0, 0, 0.44)',
                      color: 'inherit'
                    },
                    '& .MuiDataGrid-row.selected': {
                      backgroundColor: 'rgba(0, 0, 255, 0.22)',
                      color: 'inherit'
                    },
                    '& .MuiDataGrid-cell': {
                      padding: '8px'
                    },
                    '& .MuiDataGrid-footerContainer': {
                      display: 'none'
                    }
                  }}
                />
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          {!isConfirmStep ? (
            <>
              <Button onClick={handleConfirm} color="primary">
                Confirm
              </Button>
              <Button onClick={handleClose} color="primary">
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button onClick={handleFinalConfirm} color="primary" disabled={!isRowSelected}>
                Confirm Selection
              </Button>
              <Button onClick={handleClose} color="primary">
                Cancel
              </Button>
            </>
          )}
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
};

export default ReEnterDataModal;
