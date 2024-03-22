"use client";
import React, { Dispatch, SetStateAction, useEffect, useState } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import CircularProgress from '@mui/material/CircularProgress';
import { useSiteContext } from "@/app/contexts/userselectionprovider";
import {PersonnelRDS} from "@/config/sqlmacros";
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';

export interface PersonnelAutocompleteMultiSelectProps {
  initialValue: PersonnelRDS[];
  onChange: (selected: PersonnelRDS[]) => void;
  locked: boolean;
}

export const PersonnelAutocompleteMultiSelect: React.FC<PersonnelAutocompleteMultiSelectProps> = (props) => {
  const { initialValue, locked, onChange } = props;
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<PersonnelRDS[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [openDialog, setOpenDialog] = useState(false);
  const [tempSelectedPersonnel, setTempSelectedPersonnel] = useState<PersonnelRDS[]>([]);

  const loading = open && options.length === 0;
  const currentSite = useSiteContext();
  if (!currentSite) throw new Error("Site must be selected!");

  const handleConfirm = () => {
    setOpenDialog(false);
    onChange(tempSelectedPersonnel);
  };

  const handleCancel = () => {
    setOpenDialog(false);
    setTempSelectedPersonnel(initialValue);
  };


  useEffect(() => {
    let active = true;

    if (!loading) {
      return undefined;
    }

    (async () => {
      const response = await fetch(`/api/formsearch/personnelblock?schema=${currentSite.schemaName}&searchfor=${encodeURIComponent(inputValue)}`, {method: 'GET'});
      const items = await response.json();
      console.log(items);
      if (active) {
        setOptions(items);
      }
    })();

    return () => {
      active = false;
    };
  }, [loading, inputValue]);

  useEffect(() => {
    if (!open) {
      setOptions([]);
    }
  }, [open]);

  return (
    <>
      <Autocomplete
        multiple
        className={"fullWidthAutoComplete"}
        open={open}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
        options={options}
        getOptionLabel={(option) => `${option.lastName}, ${option.firstName} | ${option.role}`}
        isOptionEqualToValue={(option, value) => option.personnelID === value.personnelID}
        loading={loading}
        value={initialValue}
        disabled={locked}
        onChange={(_event, newValue) => {
          setTempSelectedPersonnel(newValue);
          setOpenDialog(true);
        } }
        filterSelectedOptions
        renderInput={(params) => (
          <TextField
            sx={{ marginTop: '10px', marginBottom: '5px' }}
            {...params}
            fullWidth
            label="Select Personnel"
            InputProps={{
              ...params.InputProps,
              endAdornment: (
                <>
                  {loading ? <CircularProgress color="inherit" size={20} /> : null}
                  {params.InputProps.endAdornment}
                </>
              ),
            }} 
          />
        )} 
      />
      <Dialog open={openDialog} onClose={handleCancel}>
        <DialogTitle>Confirm Personnel Change</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to change the assigned personnel?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancel}>Cancel</Button>
          <Button onClick={handleConfirm} color="primary">Confirm</Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
