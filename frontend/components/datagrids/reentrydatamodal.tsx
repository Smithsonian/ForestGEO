"use client";
import React, { useState, useEffect } from 'react';
import { GridRowModel, GridColDef } from "@mui/x-data-grid";
import moment from 'moment';
import { unitSelectionOptions } from '@/config/macros';
import { AttributeStatusOptions } from '@/config/sqlrdsdefinitions/tables/attributerds';
import { Button, DialogActions, DialogContent, DialogTitle, FormControl, FormLabel, Input, Modal, ModalDialog, Option, Select, Stack } from '@mui/joy';
import { DatePicker } from '@mui/x-date-pickers';

interface ReEnterDataModalProps {
  row: GridRowModel;
  reEnterData: GridRowModel | null;
  setReEnterData: (data: GridRowModel) => void;
  handleClose: () => void;
  handleSave: () => void;
  columns: GridColDef[];
}

const ReEnterDataModal: React.FC<ReEnterDataModalProps> = ({
  row,
  reEnterData,
  setReEnterData,
  handleClose,
  handleSave,
  columns,
}) => {
  const [localData, setLocalData] = useState<GridRowModel>({ ...row });

  useEffect(() => {
    // Reset the fields that have been changed to empty strings only once on mount
    const initialData = { ...row };
    columns.forEach((column) => {
      const { field, editable } = column;
      if (editable && initialData[field] !== localData[field]) {
        initialData[field] = '';
      }
    });
    setLocalData(initialData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  const handleInputChange = (field: string, value: any) => {
    setLocalData((prevData) => ({
      ...prevData,
      [field]: value,
    }));
  };

  const validateData = () => {
    const allFieldsMatch = Object.keys(row).every((field) => row[field] === localData[field]);
    return allFieldsMatch;
  };

  const handleConfirm = () => {
    if (validateData()) {
      setReEnterData(localData);
      handleSave();
    } else {
      alert("Values do not match. Please re-enter correctly.");
    }
  };

  return (
    <Modal open onClose={handleClose}>
      <ModalDialog variant="outlined" role="alertdialog">
        <DialogTitle>Confirm Changes</DialogTitle>
        <DialogContent>
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
                      onChange={(e: any) => handleInputChange(field, e.target.value)}
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
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} color="primary">
            Cancel
          </Button>
          <Button onClick={handleConfirm} color="primary">
            Confirm
          </Button>
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
};

export default ReEnterDataModal;
