"use client";
import React, {useEffect, useState} from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import CircularProgress from '@mui/material/CircularProgress';
import {useSiteContext} from "@/app/contexts/userselectionprovider";

export interface AutocompleteMultiSelectProps {
  initialValue: string[];
  onChange: (selected: string[]) => void;
}

export const AutocompleteMultiSelect: React.FC<AutocompleteMultiSelectProps> = (props) => {
  const {initialValue, onChange} = props;
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<string[]>([]);
  const [inputValue, _setInputValue] = useState('');
  const loading = open && options.length === 0;
  const currentSite = useSiteContext();
  if (!currentSite) throw new Error("Site must be selected!");

  useEffect(() => {
    let active = true;

    if (!loading) {
      return undefined;
    }

    (async () => {
      const response = await fetch(`/api/formsearch/attributes?schema=${currentSite.schemaName}&searchfor=${encodeURIComponent(inputValue)}`);
      const items = await response.json();

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
      getOptionLabel={(option) => option}
      isOptionEqualToValue={(option, value) => option === value}
      loading={loading}
      value={initialValue}
      onChange={(_event, newValue) => onChange(newValue)}
      filterSelectedOptions
      renderInput={(params) => (
        <TextField
          {...params}
          fullWidth
          label="Select Codes"
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
