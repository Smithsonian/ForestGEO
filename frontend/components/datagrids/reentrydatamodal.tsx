"use client";
import React, { useState, useEffect } from 'react';
import { GridRowModel, GridColDef } from "@mui/x-data-grid";
import moment from 'moment';
import { unitSelectionOptions } from '@/config/macros';
import { AttributeStatusOptions } from '@/config/sqlrdsdefinitions/tables/attributerds';
import { Button, DialogActions, DialogContent, DialogTitle, FormControl, FormLabel, Input, Modal, ModalDialog, Option, Select, Stack, Typography, Box } from '@mui/joy';
import { DatePicker } from '@mui/x-date-pickers';

interface ReEnterDataModalProps {
  row: GridRowModel;
  reEnterData: GridRowModel | null;
  handleClose: () => void;
  handleSave: (selectedRow: GridRowModel) => void;
  columns: GridColDef[];
}

const ReEnterDataModal: React.FC<ReEnterDataModalProps> = ({
  row,
  reEnterData,
  handleClose,
  handleSave,
  columns,
}) => {
  const [localData, setLocalData] = useState<GridRowModel>({ ...reEnterData });
  const [selectedRow, setSelectedRow] = useState<GridRowModel | null>(null);
  const [isConfirmStep, setIsConfirmStep] = useState(false);

  useEffect(() => {
    if (reEnterData) {
      const initialData = { ...row };
      columns.forEach((column) => {
        const { field, editable } = column;
        if (editable && initialData[field] !== localData[field] && 
          (initialData[field] !== '' || initialData[field] !== null || initialData[field] !== undefined || initialData[field] !== false || initialData[field] !== 0)) { // empty/default value here means that this is a new entry, should be preserved
          initialData[field] = '';
        }
      });
      setLocalData({ ...initialData });
    }
  }, [row, reEnterData, columns]);

  const handleInputChange = (field: string, value: any) => {
    setLocalData((prevData) => ({
      ...prevData,
      [field]: value,
    }));
  };

  const handleConfirm = () => {
    setIsConfirmStep(true);
  };

  const handleRowSelect = (row: GridRowModel) => {
    setSelectedRow(row);
    handleSave(row);
  };

  return (
    <Modal open onClose={handleClose}>
      <ModalDialog variant="outlined" role="alertdialog">
        <DialogTitle>Confirm Changes</DialogTitle>
        <DialogContent>
          {!isConfirmStep ? (
            <Stack direction={'row'} spacing={2} sx={{ width: '100%' }}>
              {columns.map((column) => {
                const { field, type, editable } = column;
                const value = localData[field];
                if (!editable) {
                  return null;
                }
                if (type === 'singleSelect') {
                  const valueOptions = field !== 'status' ? unitSelectionOptions : AttributeStatusOptions;
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
                        {valueOptions.map((option) => (
                          <Option key={option} value={option}>
                            {option}
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
                        onChange={(newValue) => {
                          if (newValue) handleInputChange(field, moment(newValue).utc().format('YYYY-MM-DD'));
                        }}
                      />
                    </FormControl>
                  );
                }
                return (
                  <FormControl key={field}>
                    <FormLabel>{column.headerName}</FormLabel>
                    <Input
                      placeholder={column.headerName}
                      value={value}
                      onChange={(e) => handleInputChange(field, e.target.value)}
                      fullWidth
                    />
                  </FormControl>
                );
              })}
            </Stack>
          ) : (
            <div className="mt-4">
              <Typography level='title-md' className="mb-4">Select the correct row:</Typography>
              <Box className="flex flex-col space-y-4">
                <Stack
                  className={`p-4 mb-4 cursor-pointer border-2 transition-transform duration-500 ease-in-out transform ${selectedRow === reEnterData ? 'border-blue-500 scale-105' : 'border-transparent'}`}
                  onClick={() => handleRowSelect(reEnterData!)}
                >
                  {columns.map((column) => (
                    <Typography key={column.field}><strong>{column.headerName}:</strong> {reEnterData ? reEnterData[column.field] : ''}</Typography>
                  ))}
                </Stack>
                <Box
                  className={`p-4 mb-4 cursor-pointer border-2 transition-transform duration-500 ease-in-out transform ${selectedRow === localData ? 'border-blue-500 scale-105' : 'border-transparent'}`}
                  onClick={() => handleRowSelect(localData)}
                >
                  {columns.map((column) => (
                    <Typography key={column.field}><strong>{column.headerName}:</strong> {localData[column.field]}</Typography>
                  ))}
                </Box>
              </Box>
            </div>
          )}
        </DialogContent>
        <DialogActions>
          {!isConfirmStep ? (
            <>
              <Button onClick={handleClose} color="primary">
                Cancel
              </Button>
              <Button onClick={handleConfirm} color="primary">
                Confirm
              </Button>
            </>
          ) : (
            <Button onClick={handleClose} color="primary">
              Cancel
            </Button>
          )}
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
};

export default ReEnterDataModal;
