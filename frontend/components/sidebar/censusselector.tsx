/**
 * Census Selector Component
 *
 * Handles census selection in the sidebar
 * Uses Zustand store for state management
 */

'use client';

import { Select, Option, Typography, Stack, SelectOption, Box } from '@mui/joy';
import { useAppStore } from '@/config/store/appstore';

export default function CensusSelector() {
  const currentCensus = useAppStore(state => state.currentCensus);
  const censusList = useAppStore(state => state.censusList);
  const setCensus = useAppStore(state => state.setCensus);

  const renderCensusValue = (option: SelectOption<string> | null) => {
    if (!option) {
      return (
        <Typography data-testid="pending-census-select" level="body-lg" className="sidebar-item">
          Select a Census
        </Typography>
      );
    }

    const selectedValue = option.value;
    const selectedCensus = censusList?.find(c => c?.plotCensusNumber?.toString() === selectedValue);

    if (!selectedCensus) {
      return (
        <Typography className="sidebar-item" data-testid="pending-census-select">
          Select a Census
        </Typography>
      );
    }

    const startDate = currentCensus?.dateRanges?.[0]?.startDate;
    const endDate = currentCensus?.dateRanges?.[0]?.endDate;

    const hasStartDate = startDate !== undefined && startDate !== null;
    const hasEndDate = endDate !== undefined && endDate !== null;

    // Ensure dates are rendered in a block layout to stack them vertically
    const dateMessage = (
      <span aria-label="census record information" style={{ display: 'block' }}>
        {hasStartDate && <Typography display="block">&mdash;{` First Record: ${new Date(startDate).toDateString()}`}</Typography>}
        {hasEndDate && <Typography display="block">&mdash;{` Last Record: ${new Date(endDate).toDateString()}`}</Typography>}
        {!hasStartDate && !hasEndDate && <Typography display="block">No Measurements</Typography>}
      </span>
    );

    return (
      <Stack direction="column" alignItems="start" id="selected-census-stack">
        <Typography level="body-md" className="sidebar-item" data-testid="selected-census-plotcensusnumber">
          Census: {selectedCensus.plotCensusNumber}
        </Typography>
        <Stack direction="column" alignItems="start">
          <Typography color={!currentCensus ? 'danger' : 'primary'} level="body-sm" className="sidebar-item" data-testid="selected-census-dates">
            {currentCensus !== undefined && dateMessage}
          </Typography>
        </Stack>
      </Stack>
    );
  };

  const handleCensusChange = (_event: React.SyntheticEvent | null, selectedPlotCensusNumberStr: string | null) => {
    try {
      if (selectedPlotCensusNumberStr === '' || selectedPlotCensusNumberStr === null) {
        setCensus(undefined);
      } else {
        const selectedPlotCensusNumber = parseInt(selectedPlotCensusNumberStr, 10);
        const selectedCensus = censusList?.find(census => census?.plotCensusNumber === selectedPlotCensusNumber) || undefined;
        setCensus(selectedCensus);
      }
    } catch (error) {
      console.error('Error changing census:', error);
      // Reset to undefined to prevent stale state
      setCensus(undefined);
    }
  };

  return (
    <Select
      suppressHydrationWarning
      placeholder="Select a Census. Required"
      className="census-select sidebar-item"
      name="None"
      required
      size="md"
      renderValue={renderCensusValue}
      value={currentCensus?.plotCensusNumber?.toString() || ''}
      onChange={handleCensusChange}
      data-testid="census-select-component"
      aria-label="Select a Census. Required field for accessing measurement tools"
    >
      {Array.isArray(censusList) &&
        censusList
          .sort((a, b) => (b?.plotCensusNumber ?? 0) - (a?.plotCensusNumber ?? 0))
          .map(item => (
            <Option
              aria-label={`Census ${item?.plotCensusNumber}${
                item?.dateRanges?.length
                  ? `, first measurement: ${item.dateRanges[0]?.startDate ? new Date(item.dateRanges[0].startDate).toDateString() : 'No measurements'}`
                  : ''
              }`}
              data-testid="census-selection-option"
              key={item?.plotCensusNumber}
              value={item?.plotCensusNumber?.toString()}
            >
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  width: '100%',
                  gap: 1
                }}
                className="sidebar-item"
              >
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <Typography level="body-lg" data-testid="census-selection-option-plotcensusnumber">
                    Census: {item?.plotCensusNumber}
                  </Typography>
                  {Array.isArray(item?.dateRanges) &&
                    item.dateRanges.map((dateRange, index) => (
                      <Box key={index}>
                        <Stack direction="row">
                          <Typography level="body-sm" color="neutral">
                            {dateRange?.startDate ? `First: ${new Date(dateRange.startDate).toDateString()}` : 'No Start Date'}
                          </Typography>
                        </Stack>
                        <Stack direction="row">
                          <Typography level="body-sm" color="neutral">
                            {dateRange?.endDate ? `Last: ${new Date(dateRange.endDate).toDateString()}` : 'No End Date'}
                          </Typography>
                        </Stack>
                      </Box>
                    ))}
                </Box>
              </Box>
            </Option>
          ))}
    </Select>
  );
}
