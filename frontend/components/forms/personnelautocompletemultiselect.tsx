"use client";
import React, { Dispatch, SetStateAction, useEffect, useState } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import CircularProgress from '@mui/material/CircularProgress';
import { useSiteContext } from "@/app/contexts/userselectionprovider";
import {PersonnelRDS} from "@/config/sqlmacros";

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
  const loading = open && options.length === 0;
  const currentSite = useSiteContext();
  if (!currentSite) throw new Error("Site must be selected!");

  useEffect(() => {
    let active = true;

    if (!loading) {
      return undefined;
    }

    (async () => {
      const response = await fetch(`/api/formsearch/personnelblock?schema=${currentSite.schemaName}&searchfor=${encodeURIComponent(inputValue)}`);
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
      onChange={(_event, newValue) => onChange(newValue)}
      filterSelectedOptions
      renderInput={(params) => (
        <TextField
          sx={{marginTop: '10px', marginBottom: '5px'}}
          {...params}
          fullWidth
          label="Select Personnel"
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {loading ? <CircularProgress color="inherit" size={20}/> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
    />
  );
};
