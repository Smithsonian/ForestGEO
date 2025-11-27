/**
 * Plot Selector Component
 *
 * Handles plot selection in the sidebar
 * Uses Zustand store for state management
 */

'use client';

import { Select, Option, Typography, Stack, SelectOption, Box, List, ListItem, ListDivider } from '@mui/joy';
import { useAppStore } from '@/config/store/appstore';
import { Plot } from '@/config/sqlrdsdefinitions/zones';
import React, { useMemo, useCallback } from 'react';
import { CheckCircle, Cancel } from '@mui/icons-material';

export default function PlotSelector() {
  const currentPlot = useAppStore(state => state.currentPlot);
  const plotList = useAppStore(state => state.plotList);
  const setPlot = useAppStore(state => state.setPlot);
  const setCensus = useAppStore(state => state.setCensus);

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

  // Helper to render a plot option
  const renderPlotOption = useCallback(
    (plot: Plot) => (
      <Option aria-label={`plot name option: ${plot?.plotName}`} data-testid="plot-selection-option" key={plot?.plotID} value={plot?.plotID}>
        <Stack direction="column" alignItems="start" className="sidebar-item">
          <Typography level="body-md" data-testid="plot-selection-option-name">
            {plot?.plotName}
          </Typography>
          <Typography level="body-sm" color={plot?.numQuadrats && plot.numQuadrats > 0 ? 'success' : 'neutral'}>
            &mdash; {plot?.numQuadrats && plot.numQuadrats > 0 ? `Quadrats: ${plot.numQuadrats}` : 'No Quadrats'}
          </Typography>
        </Stack>
      </Option>
    ),
    []
  );

  // Build grouped options using List and ListItem with sticky headers (Joy UI pattern)
  const plotOptions = useMemo(() => {
    const groups: React.ReactNode[] = [];

    // Add plots with quadrats first (if any exist)
    if (plotsWithQuadrats.length > 0) {
      groups.push(
        <React.Fragment key="with-quadrats-group">
          <List aria-labelledby="select-group-with-quadrats" sx={{ '--ListItemDecorator-size': '28px' }}>
            <ListItem
              id="select-group-with-quadrats"
              sticky
              sx={{
                bgcolor: 'success.softBg',
                display: 'flex',
                alignItems: 'center',
                gap: 1
              }}
            >
              <CheckCircle sx={{ fontSize: 16, color: 'success.600' }} />
              <Typography level="body-xs" sx={{ textTransform: 'uppercase', color: 'success.700', fontWeight: 'lg' }}>
                With Quadrats ({plotsWithQuadrats.length})
              </Typography>
            </ListItem>
            {plotsWithQuadrats.map(plot => renderPlotOption(plot))}
          </List>
        </React.Fragment>
      );
    }

    // Add divider between sections if both exist
    if (plotsWithQuadrats.length > 0 && plotsWithoutQuadrats.length > 0) {
      groups.push(<ListDivider key="section-divider" role="none" />);
    }

    // Add plots without quadrats (if any exist)
    if (plotsWithoutQuadrats.length > 0) {
      groups.push(
        <React.Fragment key="without-quadrats-group">
          <List aria-labelledby="select-group-without-quadrats" sx={{ '--ListItemDecorator-size': '28px' }}>
            <ListItem
              id="select-group-without-quadrats"
              sticky
              sx={{
                bgcolor: 'neutral.softBg',
                display: 'flex',
                alignItems: 'center',
                gap: 1
              }}
            >
              <Cancel sx={{ fontSize: 16, color: 'neutral.500' }} />
              <Typography level="body-xs" sx={{ textTransform: 'uppercase', color: 'neutral.600', fontWeight: 'lg' }}>
                Without Quadrats ({plotsWithoutQuadrats.length})
              </Typography>
            </ListItem>
            {plotsWithoutQuadrats.map(plot => renderPlotOption(plot))}
          </List>
        </React.Fragment>
      );
    }

    return groups;
  }, [plotsWithQuadrats, plotsWithoutQuadrats, renderPlotOption]);

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
      onChange={handlePlotChange}
      data-testid="plot-select-component"
      aria-label="Select a Plot. Required field for accessing measurement tools"
      slotProps={{
        listbox: {
          component: 'div',
          sx: {
            maxHeight: 300,
            overflow: 'auto',
            '--List-padding': '0px',
            '--ListItem-radius': '0px'
          }
        }
      }}
    >
      {plotOptions}
    </Select>
  );
}
