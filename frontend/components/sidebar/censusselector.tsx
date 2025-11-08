/**
 * Census Selector Component
 *
 * Handles census selection in the sidebar
 * Includes functionality to create new censuses
 * Uses Zustand store for state management
 */

'use client';

import { Select, Option, Typography, Stack, SelectOption, Box, IconButton, ListItem, Divider } from '@mui/joy';
import { useAppStore } from '@/config/store/appstore';
import { OrgCensusToCensusResultMapper } from '@/config/sqlrdsdefinitions/timekeeping';
import { useState } from 'react';
import AddIcon from '@mui/icons-material/Add';
import ailogger from '@/ailogger';

interface CensusSelectorProps {
  onCensusListChanged?: () => void;
}

export default function CensusSelector({ onCensusListChanged }: CensusSelectorProps) {
  const currentCensus = useAppStore(state => state.currentCensus);
  const censusList = useAppStore(state => state.censusList);
  const setCensus = useAppStore(state => state.setCensus);
  const currentSite = useAppStore(state => state.currentSite);
  const currentPlot = useAppStore(state => state.currentPlot);

  const [isCreatingCensus, setIsCreatingCensus] = useState(false);

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

  const handleCensusChange = async (_event: React.SyntheticEvent | null, selectedPlotCensusNumberStr: string | null) => {
    if (selectedPlotCensusNumberStr === '' || selectedPlotCensusNumberStr === null) {
      setCensus(undefined);
    } else {
      const selectedPlotCensusNumber = parseInt(selectedPlotCensusNumberStr, 10);
      const selectedCensus = censusList?.find(census => census?.plotCensusNumber === selectedPlotCensusNumber) || undefined;
      setCensus(selectedCensus);
    }
  };

  const handleCreateNewCensus = async () => {
    if (isCreatingCensus) return; // Prevent multiple clicks

    // Validation checks
    if (currentCensus && (!currentCensus.dateRanges || currentCensus.dateRanges.length === 0 || !currentCensus.dateRanges[0].startDate)) {
      alert('Cannot create a new census: Current census has no measurements.');
      return;
    }

    // Check if any existing census has no measurements
    const censusWithoutMeasurements = censusList?.find(census => !census?.dateRanges || census.dateRanges.length === 0 || !census.dateRanges[0]?.startDate);

    if (censusWithoutMeasurements) {
      alert(`Cannot create a new census: Census ${censusWithoutMeasurements.plotCensusNumber} has no measurements.`);
      return;
    }

    setIsCreatingCensus(true);

    try {
      // Calculate next census number
      const highestPlotCensusNumber =
        censusList && censusList.length > 0
          ? censusList.reduce(
              (max, census) => ((census?.plotCensusNumber ?? 0) > max ? (census?.plotCensusNumber ?? 0) : max),
              censusList[0]?.plotCensusNumber ?? 0
            )
          : 0;

      const mapper = new OrgCensusToCensusResultMapper();
      const newCensusID = await mapper.startNewCensus(currentSite?.schemaName ?? '', currentPlot?.plotID ?? 0, highestPlotCensusNumber + 1);

      if (!newCensusID) {
        alert('Failed to create new census - census creation returned invalid ID. Please ensure site and plot are properly selected.');
        return;
      }

      // Rollover data from current census to new census
      await Promise.all(
        ['attributes', 'personnel', 'quadrats', 'species'].map(async key => {
          await fetch(`/api/rollover/${key}/${currentSite!.schemaName}/${currentPlot!.plotID}/${currentCensus?.dateRanges[0].censusID}/${newCensusID}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ incoming: {} })
          });
        })
      );

      // Notify parent that census list needs refresh
      if (onCensusListChanged) {
        onCensusListChanged();
      }

      ailogger.info(`New census created successfully: Census ${highestPlotCensusNumber + 1}`);
    } catch (error) {
      ailogger.error('Error creating census:', error as Error);
      alert('Failed to create census. Please try again.');
    } finally {
      // Debounce: prevent rapid successive clicks
      setTimeout(() => setIsCreatingCensus(false), 1000);
    }
  };

  // Check if "Add New Census" button should be disabled
  const isAddCensusDisabled =
    isCreatingCensus ||
    // Prevent creation if current census has no measurements
    (currentCensus && (!currentCensus.dateRanges || currentCensus.dateRanges.length === 0 || !currentCensus.dateRanges[0].startDate)) ||
    // Prevent creation if any census in the list has no measurements
    censusList?.some(census => !census?.dateRanges || census.dateRanges.length === 0 || !census.dateRanges[0]?.startDate);

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
      {/* Add New Census Option */}
      <ListItem>
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            width: '100%',
            padding: '8px 12px'
          }}
        >
          <Typography level="body-sm" color="primary">
            Add New Census
          </Typography>
          <IconButton
            aria-label="add new census icon button"
            size="sm"
            color="primary"
            data-testid="add-new-census-button"
            tabIndex={0}
            disabled={isAddCensusDisabled}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                handleCreateNewCensus();
              }
            }}
            onClick={handleCreateNewCensus}
          >
            <AddIcon />
          </IconButton>
        </Box>
      </ListItem>
      <Divider orientation="horizontal" sx={{ my: 1 }} />

      {/* Census List */}
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
