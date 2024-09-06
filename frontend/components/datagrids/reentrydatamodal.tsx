'use client';
import React, { useEffect, useState } from 'react';
import { DataGrid, GridColDef, GridRenderCellParams, GridRowModel } from '@mui/x-data-grid';
import moment from 'moment';
import { ColumnStates, unitSelectionOptions } from '@/config/macros';
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

import { AttributeStatusOptions } from '@/config/sqlrdsdefinitions/core';

interface ReEnterDataModalProps {
  row: GridRowModel;
  reEnterData: GridRowModel | null;
  handleClose: () => void;
  handleSave: (selectedRow: GridRowModel) => void;
  columns: GridColDef[];
  selectionOptions?: { value: string | number; label: string }[];
  hiddenColumns?: ColumnStates;
}

const ReEnterDataModal: React.FC<ReEnterDataModalProps> = ({ row, reEnterData, handleClose, handleSave, columns, selectionOptions, hiddenColumns }) => {
  const [localData, setLocalData] = useState<GridRowModel>({ ...reEnterData });
  const [selectedRow, setSelectedRow] = useState<GridRowModel | null>(null);
  const [isConfirmStep, setIsConfirmStep] = useState(false);
  const [isRowSelected, setIsRowSelected] = useState(false);

  const calculateDialogWidth = () => {
    const baseWidth = 300;
    const totalFlex = columns.reduce((acc, column) => acc + (column.flex || 0), 0);
    const totalMinWidth = columns.reduce((acc, column) => acc + (column.minWidth || 0), 0);
    const flexWidth = totalFlex ? totalFlex * 100 : 0;

    return Math.max(baseWidth + flexWidth, totalMinWidth);
  };

  const dialogWidth = calculateDialogWidth();

  useEffect(() => {
    if (reEnterData) {
      const initialData = { ...row };
      columns.forEach(column => {
        const { field, editable } = column;
        if (
          editable &&
          initialData[field] !== localData[field] &&
          (initialData[field] !== '' ||
            initialData[field] !== null ||
            initialData[field] !== undefined ||
            initialData[field] !== false ||
            initialData[field] !== 0)
        ) {
          initialData[field] = '';
        }
      });
      setLocalData({ ...initialData });
    }
  }, [row, reEnterData, columns]);

  const handleInputChange = (field: string, value: any) => {
    setLocalData(prevData => ({
      ...prevData,
      [field]: value
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
      handleSave(remaining);
    }
  };

  const getOptionLabel = (_field: string, value: any) => {
    if (selectionOptions) {
      const option = selectionOptions.find(opt => opt.value === value);
      return option ? option.label : value;
    }
    return value;
  };

  // Filter the columns based on hiddenColumns
  const filteredColumns = columns.filter(column => {
    const isHidden = hiddenColumns ? hiddenColumns[column.field] === false : false;
    return !isHidden;
  });

  return (
    <Modal open onClose={handleClose}>
      <ModalDialog variant="outlined" role="alertdialog" sx={{ width: 'auto', maxWidth: '90vw', overflow: 'auto' }}>
        <DialogTitle>Confirm Changes</DialogTitle>
        <DialogContent>
          {!isConfirmStep ? (
            <Stack direction={'row'} spacing={2} sx={{ width: '100%' }}>
              {filteredColumns.map(column => {
                const { field, type, editable } = column;
                const value = localData[field];
                if (!editable) {
                  return null;
                }
                if (type === 'singleSelect') {
                  let valueOptions;
                  if (field.toLowerCase().includes('unit')) {
                    valueOptions = unitSelectionOptions;
                  } else if (field === 'status') {
                    valueOptions = AttributeStatusOptions;
                  } else {
                    valueOptions = selectionOptions;
                  }

                  return (
                    <FormControl key={field}>
                      <FormLabel>{column.headerName}</FormLabel>
                      <Select
                        placeholder={column.headerName}
                        value={value}
                        onChange={(_event, newValue) => {
                          handleInputChange(field, newValue);
                        }}
                      >
                        {(valueOptions === unitSelectionOptions || valueOptions === AttributeStatusOptions) &&
                          valueOptions.map(option => (
                            <Option key={option} value={option}>
                              {option}
                            </Option>
                          ))}
                        {valueOptions === selectionOptions &&
                          valueOptions?.map(option => (
                            <Option key={option.value} value={option.value}>
                              {option.label}
                            </Option>
                          ))}
                      </Select>
                    </FormControl>
                  );
                }
                if (type === 'date') {
                  return (
                    <FormControl key={field}>
                      <FormLabel>{column.headerName}</FormLabel>
                      <DatePicker
                        label={column.headerName}
                        value={value ? moment(value).utc() : null}
                        onChange={newValue => {
                          if (newValue) handleInputChange(field, moment(newValue).utc().format('YYYY-MM-DD'));
                        }}
                      />
                    </FormControl>
                  );
                }
                return (
                  <FormControl key={field}>
                    <FormLabel>{column.headerName}</FormLabel>
                    <Input placeholder={column.headerName} value={value} onChange={e => handleInputChange(field, e.target.value)} fullWidth />
                  </FormControl>
                );
              })}
            </Stack>
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
                  rows={[
                    { ...row, id: 'starter', label: 'Original' },
                    {
                      ...reEnterData,
                      id: 'original',
                      label: 'First Modification'
                    },
                    {
                      ...localData,
                      id: 'modified',
                      label: 'Second Modification (Re-entry)'
                    }
                  ]}
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
                      renderCell: (params: GridRenderCellParams) => (
                        <Box
                          sx={{
                            whiteSpace: 'normal',
                            wordWrap: 'break-word',
                            width: '100%'
                          }}
                        >
                          {selectionOptions && col.type === 'singleSelect' ? getOptionLabel(col.field, params.value) : params.value}
                        </Box>
                      )
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
