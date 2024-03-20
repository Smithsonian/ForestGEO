import React, {useEffect, useState} from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import CircularProgress from '@mui/material/CircularProgress';
import {useSiteContext} from "@/app/contexts/userselectionprovider";
import {PersonnelRDS} from "@/config/sqlmacros";

interface PersonnelAutocompleteMultiSelectProps {
  initialValue: PersonnelRDS[];
  onChange: (selectedPersonnel: PersonnelRDS[]) => void;
  quadratID: number;
}

export const PersonnelAutocompleteMultiSelect: React.FC<PersonnelAutocompleteMultiSelectProps> = ({
                                                                                                    initialValue,
                                                                                                    onChange,
                                                                                                    quadratID
                                                                                                  }) => {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<PersonnelRDS[]>([]);
  const [loading, setLoading] = useState(false);
  const currentSite = useSiteContext();

  useEffect(() => {
    if (!currentSite) throw new Error("Site must be selected!");

    setLoading(true);
    fetch(`/api/formsearch/personnel?schema=${currentSite.schemaName}`)
      .then(response => response.json())
      .then((data: PersonnelRDS[]) => {
        setOptions(data);
      })
      .catch(error => console.error('Error fetching personnel:', error))
      .finally(() => setLoading(false));
  }, [currentSite]);

  useEffect(() => {
    if (!open) {
      setOptions([]);
    }
  }, [open]);

  return (
    <Autocomplete
      multiple
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      options={options}
      getOptionLabel={(option) => `${option.firstName} ${option.lastName}`}
      isOptionEqualToValue={(option, value) => option.personnelID === value.personnelID}
      loading={loading}
      value={initialValue}
      onChange={(_event, newValue) => onChange(newValue)}
      filterSelectedOptions
      renderInput={(params) => (
        <TextField
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
