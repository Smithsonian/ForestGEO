/**
 * Plot Selector Component
 *
 * Handles plot selection in the sidebar
 * Uses Zustand store for state management
 *
 * Simplified version - editing functionality moved to dashboard cards
 */

'use client';

import { Select, Option, Typography, Stack, SelectOption, Box, ListItem, ListDivider } from '@mui/joy';
import { useAppStore } from '@/config/store/appstore';
import { Plot } from '@/config/sqlrdsdefinitions/zones';
import React, { useMemo, useCallback, useState } from 'react';
import { CheckCircle, Cancel } from '@mui/icons-material';

export default function PlotSelector() {
  const currentPlot = useAppStore(state => state.currentPlot);
  const plotList = useAppStore(state => state.plotList);
  const setPlot = useAppStore(state => state.setPlot);
  const setCensus = useAppStore(state => state.setCensus);

  // Control dropdown open state to prevent scroll reset
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const renderPlotValue = useCallback(
    (option: SelectOption<number> | null) => {
      if (!option) {
        return (
          <Typography data-testid="pending-plot-select" level="body-lg" className="sidebar-item">
            Select a Plot
          </Typography>
        );
      }

      const selectedValue = option.value;
      const selectedPlot = plotList?.find(p => p?.plotID === selectedValue);

      if (!selectedPlot) {
        return (
          <Typography level="body-lg" className="sidebar-item" data-testid="pending-plot-select">
            Select a Plot
          </Typography>
        );
      }

      return (
        <Stack direction="column" alignItems="start" aria-label="plot value render stack">
          <Typography id="plot-selected" level="body-md" className="sidebar-item" data-testid="selected-plot-name">
            Plot: {selectedPlot.plotName}
          </Typography>
          <Box aria-label="selected plot information" sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }} className="sidebar-item">
            <Typography level="body-sm" color="primary" data-testid="selected-plot-quadrats">
              &mdash; {selectedPlot.numQuadrats || selectedPlot.numQuadrats === 0 ? `Quadrats: ${selectedPlot.numQuadrats}` : 'No Quadrats'}
            </Typography>
          </Box>
        </Stack>
      );
    },
    [plotList]
  );

  const handlePlotChange = useCallback(
    (_event: React.SyntheticEvent | null, selectedPlotID: number | null) => {
      if (selectedPlotID === null) {
        setPlot(undefined);
        // Clear census when plot is cleared
        setCensus(undefined);
      } else {
        const selected = plotList?.find(p => p?.plotID === selectedPlotID);
        setPlot(selected as Plot);
        // Clear census when plot changes (census is plot-specific)
        setCensus(undefined);
      }
    },
    [plotList, setPlot, setCensus]
  );

  // Separate plots with and without quadrats, sort alphabetically within each group
  const { plotsWithQuadrats, plotsWithoutQuadrats } = useMemo(() => {
    if (!Array.isArray(plotList)) {
      return { plotsWithQuadrats: [], plotsWithoutQuadrats: [] };
    }

    const withQuadrats = plotList
      .filter(plot => plot?.numQuadrats !== undefined && plot.numQuadrats > 0)
      .sort((a, b) => (a?.plotName ?? '').localeCompare(b?.plotName ?? ''));

    const withoutQuadrats = plotList
      .filter(plot => plot?.numQuadrats === undefined || plot.numQuadrats === 0)
      .sort((a, b) => (a?.plotName ?? '').localeCompare(b?.plotName ?? ''));

    return { plotsWithQuadrats: withQuadrats, plotsWithoutQuadrats: withoutQuadrats };
  }, [plotList]);

  // Build plot options with grouping headers
  const plotOptions = useMemo(() => {
    const options: React.ReactNode[] = [];

    // Add "With Quadrats" section header and plots
    if (plotsWithQuadrats.length > 0) {
      options.push(
        <ListItem
          key="header-with-quadrats"
          sticky
          sx={{
            bgcolor: 'success.softBg',
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            py: 0.5,
            px: 1.5
          }}
        >
          <CheckCircle sx={{ fontSize: 16, color: 'success.600' }} />
          <Typography level="body-xs" sx={{ textTransform: 'uppercase', color: 'success.700', fontWeight: 'lg' }}>
            With Quadrats ({plotsWithQuadrats.length})
          </Typography>
        </ListItem>
      );

      plotsWithQuadrats.forEach(plot => {
        options.push(
          <Option key={plot?.plotID} value={plot?.plotID} aria-label={`plot name option: ${plot?.plotName}`} data-testid="plot-selection-option">
            <Stack direction="column" alignItems="start" className="sidebar-item">
              <Typography level="body-md" data-testid="plot-selection-option-name">
                {plot?.plotName}
              </Typography>
              <Typography level="body-sm" color="success">
                &mdash; Quadrats: {plot?.numQuadrats}
              </Typography>
            </Stack>
          </Option>
        );
      });
    }

    // Add divider between sections if both exist
    if (plotsWithQuadrats.length > 0 && plotsWithoutQuadrats.length > 0) {
      options.push(<ListDivider key="section-divider" role="none" />);
    }

    // Add "Without Quadrats" section header and plots
    if (plotsWithoutQuadrats.length > 0) {
      options.push(
        <ListItem
          key="header-without-quadrats"
          sticky
          sx={{
            bgcolor: 'neutral.softBg',
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            py: 0.5,
            px: 1.5
          }}
        >
          <Cancel sx={{ fontSize: 16, color: 'neutral.500' }} />
          <Typography level="body-xs" sx={{ textTransform: 'uppercase', color: 'neutral.600', fontWeight: 'lg' }}>
            Without Quadrats ({plotsWithoutQuadrats.length})
          </Typography>
        </ListItem>
      );

      plotsWithoutQuadrats.forEach(plot => {
        options.push(
          <Option key={plot?.plotID} value={plot?.plotID} aria-label={`plot name option: ${plot?.plotName}`} data-testid="plot-selection-option">
            <Stack direction="column" alignItems="start" className="sidebar-item">
              <Typography level="body-md" data-testid="plot-selection-option-name">
                {plot?.plotName}
              </Typography>
              <Typography level="body-sm" color="neutral">
                &mdash; No Quadrats
              </Typography>
            </Stack>
          </Option>
        );
      });
    }

    return options;
  }, [plotsWithQuadrats, plotsWithoutQuadrats]);

  return (
    <Select<number>
      suppressHydrationWarning
      placeholder="Select a Plot. Required"
      className="plot-select sidebar-item"
      name="None"
      required
      size="md"
      renderValue={renderPlotValue}
      value={currentPlot?.plotID ?? null}
      listboxOpen={isDropdownOpen}
      onListboxOpenChange={open => {
        setIsDropdownOpen(open);
      }}
      onClose={() => setIsDropdownOpen(false)}
      onChange={handlePlotChange}
      data-testid="plot-select-component"
      aria-label="Select a Plot. Required field for accessing measurement tools"
      slotProps={{
        listbox: {
          sx: {
            maxHeight: 300,
            overflow: 'auto'
          }
        }
      }}
    >
      {plotOptions}
    </Select>
  );
}
