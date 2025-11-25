'use client';
import Autocomplete from '@mui/material/Autocomplete';
import { useEffect, useState, useRef, useCallback } from 'react';
import { CircularProgress, Popper, TextField, Alert, Box } from '@mui/material';
import { useSiteContext } from '@/app/contexts/compat-hooks';
import ailogger from '@/ailogger';

interface AutocompleteFixedDataProps {
  dataType: string;
  value: string;
  onChange: (newValue: string) => void;
}

export default function AutocompleteFixedData(props: Readonly<AutocompleteFixedDataProps>) {
  const { value, dataType, onChange } = props;
  const [options, setOptions] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const currentSite = useSiteContext();
  if (!currentSite) throw new Error('Site must be selected!');

  // Function to refresh data with proper error handling
  const refreshData = useCallback(
    (searchValue: string) => {
      setLoading(true);
      setError(null); // Clear previous errors

      fetch(`/api/formsearch/${dataType}?schema=${currentSite.schemaName}&searchfor=${encodeURIComponent(searchValue)}`)
        .then(response => {
          if (!response.ok) {
            throw new Error(`Failed to fetch: ${response.statusText}`);
          }
          return response.json();
        })
        .then(data => {
          setOptions(data);
          setError(null); // Clear error on success
        })
        .catch(err => {
          const errorMessage = `Failed to load ${dataType} options. Please try again.`;
          setError(errorMessage);
          ailogger.error('Error fetching data:', err);
        })
        .finally(() => setLoading(false));
    },
    [dataType, currentSite.schemaName]
  );

  // Initial fetch on mount
  useEffect(() => {
    refreshData('');
  }, [refreshData]);

  // Debounced fetch on input change - single consolidated effect
  useEffect(() => {
    // Clear any pending timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set up new debounced fetch
    debounceTimerRef.current = setTimeout(() => {
      refreshData(inputValue);
    }, 500); // 500ms debounce for better UX

    // Cleanup on unmount or before next effect
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [inputValue, refreshData]);

  return (
    <Box>
      <Autocomplete
        className={'fullWidthAutoComplete'}
        value={value}
        onChange={(_event, newValue) => onChange(newValue ?? '')}
        inputValue={inputValue}
        onInputChange={(_event, newInputValue) => setInputValue(newInputValue)}
        options={options}
        isOptionEqualToValue={(option, value) => (value !== '' ? value === option : value === '')}
        renderInput={params => (
          <TextField
            {...params}
            fullWidth
            label={dataType}
            error={!!error}
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
        PopperComponent={popperProps => <Popper {...popperProps} style={{ zIndex: 9999 }} placement="bottom-start" />}
      />

      {/* Error message with aria-live for screen readers */}
      {error && (
        <Alert severity="error" role="alert" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}
    </Box>
  );
}
