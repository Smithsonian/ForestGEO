'use client';
import Autocomplete from '@mui/material/Autocomplete';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useIsMounted } from '@/app/hooks/useIsMounted';
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
  const abortControllerRef = useRef<AbortController | null>(null);
  const { isMountedRef } = useIsMounted();

  const currentSite = useSiteContext();

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      // Abort any pending fetch on unmount
      abortControllerRef.current?.abort();
    };
  }, []);

  // Function to refresh data with proper error handling and cancellation
  const refreshData = useCallback(
    (searchValue: string) => {
      // Don't fetch if site is not selected
      if (!currentSite?.schemaName) {
        return;
      }

      // Abort previous request if still pending
      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();

      setLoading(true);
      setError(null); // Clear previous errors

      fetch(`/api/formsearch/${dataType}?schema=${currentSite.schemaName}&searchfor=${encodeURIComponent(searchValue)}`, {
        signal: abortControllerRef.current.signal
      })
        .then(response => {
          if (!response.ok) {
            throw new Error(`Failed to fetch: ${response.statusText}`);
          }
          return response.json();
        })
        .then(data => {
          // Only update state if component is still mounted
          if (isMountedRef.current) {
            setOptions(data);
            setError(null); // Clear error on success
          }
        })
        .catch(err => {
          // Ignore abort errors - they're expected when cancelling
          if (err.name === 'AbortError') {
            return;
          }
          if (isMountedRef.current) {
            const errorMessage = `Failed to load ${dataType} options. Please try again.`;
            setError(errorMessage);
            ailogger.error('Error fetching data:', err);
          }
        })
        .finally(() => {
          if (isMountedRef.current) {
            setLoading(false);
          }
        });
    },
    [dataType, currentSite?.schemaName]
  );

  // Initial fetch on mount (only if site is selected)
  useEffect(() => {
    if (currentSite?.schemaName) {
      refreshData('');
    }
  }, [refreshData, currentSite?.schemaName]);

  // Debounced fetch on input change - single consolidated effect
  useEffect(() => {
    // Don't set up debounce if site is not selected
    if (!currentSite?.schemaName) {
      return;
    }

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
  }, [inputValue, refreshData, currentSite?.schemaName]);

  // Show a message if site is not selected
  if (!currentSite) {
    return (
      <Box>
        <TextField fullWidth label={dataType} disabled placeholder="Please select a site first" aria-label={`${dataType} - site selection required`} />
      </Box>
    );
  }

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
