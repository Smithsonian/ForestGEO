 "use client";
import Autocomplete from "@mui/material/Autocomplete";
import {useEffect, useState} from "react";
import {CircularProgress, Popper, TextField} from "@mui/material";

interface AutocompleteFixedDataProps {
  dataType: string;
  value: string;
  onChange: (newValue: string) => void;
}

export default function AutocompleteFixedData(props: Readonly<AutocompleteFixedDataProps>) {
  const {value, dataType, onChange} = props;
  const [options, setOptions] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [timer, setTimer] = useState<NodeJS.Timeout | null>(null);

  // Function to refresh data
  const refreshData = () => {
    setLoading(true);
    fetch(`/api/formsearch/${dataType}?searchfor=${encodeURIComponent(inputValue)}`)
      .then((response) => response.json())
      .then((data) => {
        setOptions(data);
      })
      .catch((error) => {
        console.error('Error fetching data:', error);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // Pre-load options with empty input value
    refreshData();
  }, []); // This will run only once when the component mounts

  useEffect(() => {
    if (timer) clearTimeout(timer);
    const newTimer = setTimeout(refreshData, 5000); // Refresh after 5 seconds of inactivity
    setTimer(newTimer);

    return () => {
      clearTimeout(newTimer);
    };
  }, [inputValue]);

  useEffect(() => {
    if (inputValue) {
      refreshData();
    }
  }, [inputValue]);

  return (
    <Autocomplete
      className={"fullWidthAutoComplete"}
      value={value}
      onChange={(_event, newValue) => onChange(newValue ?? '')}
      inputValue={inputValue}
      onInputChange={(_event, newInputValue) => setInputValue(newInputValue)}
      options={options}
      isOptionEqualToValue={(option, value) => value !== '' ? value === option : value === ''}
      renderInput={(params) => (
        <TextField
          {...params}
          fullWidth
          label={dataType}
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
      PopperComponent={(popperProps) => (
        <Popper {...popperProps} style={{zIndex: 9999}} placement="bottom-start"/>
      )}
    />
  );
}