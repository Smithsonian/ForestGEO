"use client";
import React, { useEffect, useState } from "react";
import Autocomplete from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";
import CircularProgress from "@mui/material/CircularProgress";
import { useSiteContext } from "@/app/contexts/userselectionprovider";
import { PersonnelRDS } from "@/config/sqlrdsdefinitions/tables/personnelrds";

export interface PersonnelAutocompleteMultiSelectProps {
  initialValue: PersonnelRDS[];
  onChange: (selected: PersonnelRDS[]) => void;
  locked: boolean;
}

export const PersonnelAutocompleteMultiSelect: React.FC<PersonnelAutocompleteMultiSelectProps> = props => {
  const { locked, onChange } = props;
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<PersonnelRDS[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [tempSelectedPersonnel, setTempSelectedPersonnel] = useState<PersonnelRDS[]>([]);
  const [timer, setTimer] = useState<NodeJS.Timeout | null>(null);

  const loading = open && options.length === 0;
  const currentSite = useSiteContext();
  if (!currentSite) throw new Error("Site must be selected!");

  // Function to refresh data
  const refreshData = () => {
    fetch(`/api/formsearch/personnelblock?schema=${currentSite.schemaName}&searchfor=${encodeURIComponent(inputValue)}`)
      .then(response => response.json())
      .then(data => {
        setOptions(data);
      })
      .catch(error => {
        console.error("Error fetching data:", error);
      });
  };
  const handleConfirm = () => {
    onChange(tempSelectedPersonnel);
  };

  useEffect(() => {
    if (timer) clearTimeout(timer);
    const newTimer = setTimeout(refreshData, 5000); // Refresh after 5 seconds of inactivity
    setTimer(newTimer);

    return () => {
      clearTimeout(newTimer);
    };
  }, [inputValue]);

  useEffect(() => {
    let active = true;

    if (!loading) {
      return undefined;
    }

    (async () => {
      const response = await fetch(`/api/formsearch/personnelblock?schema=${currentSite.schemaName}&searchfor=${encodeURIComponent(inputValue)}`, {
        method: "GET"
      });
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

  useEffect(() => {
    // Pre-load options with empty input value
    refreshData();
  }, []); // This will run only once when the component mounts

  return (
    <>
      <Autocomplete
        multiple
        className={"fullWidthAutoComplete"}
        open={open}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
        options={options}
        getOptionLabel={option => `${option.lastName}, ${option.firstName} | ${option.roleID}`}
        isOptionEqualToValue={(option, value) => JSON.stringify(option) === JSON.stringify(value)}
        loading={loading}
        value={undefined}
        disabled={locked}
        onChange={(_event, newValue) => {
          setTempSelectedPersonnel(newValue);
          handleConfirm();
          setInputValue("");
        }}
        inputValue={inputValue}
        onInputChange={(_event, newInputValue) => setInputValue(newInputValue)}
        filterSelectedOptions
        renderInput={params => (
          <TextField
            sx={{ marginTop: "10px", marginBottom: "5px" }}
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
              )
            }}
          />
        )}
      />
    </>
  );
};
