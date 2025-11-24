/**
 * Plot Selector Component
 *
 * Handles plot selection in the sidebar
 * Uses Zustand store for state management
 */

'use client';

import { Select, Option, Typography, Stack, SelectOption, Box, IconButton, Menu, MenuItem } from '@mui/joy';
import { useAppStore } from '@/config/store/appstore';
import { Plot } from '@/config/sqlrdsdefinitions/zones';
import { useState } from 'react';
import { MoreHoriz } from '@mui/icons-material';

interface PlotSelectorProps {
  onPlotEdit?: (plot: Plot) => void;
}

export default function PlotSelector({ onPlotEdit }: PlotSelectorProps) {
  const currentPlot = useAppStore(state => state.currentPlot);
  const plotList = useAppStore(state => state.plotList);
  const setPlot = useAppStore(state => state.setPlot);
  const setCensus = useAppStore(state => state.setCensus);

  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [selectedPlotForMenu, setSelectedPlotForMenu] = useState<Plot | undefined>(undefined);

  const renderPlotValue = (option: SelectOption<number> | null) => {
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
  };

  const handlePlotChange = async (_event: React.SyntheticEvent | null, selectedPlotID: number | null) => {
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
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, plot: Plot) => {
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
    setSelectedPlotForMenu(plot);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setSelectedPlotForMenu(undefined);
  };

  const handleEditPlot = () => {
    if (selectedPlotForMenu && onPlotEdit) {
      onPlotEdit(selectedPlotForMenu);
    }
    handleMenuClose();
  };

  return (
    <>
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
      >
        {Array.isArray(plotList) &&
          plotList.map(plot => (
            <Option
              aria-label={`Plot: ${plot?.plotName}${plot?.numQuadrats !== undefined ? `, Quadrats: ${plot.numQuadrats}` : ''}`}
              data-testid="plot-selection-option"
              key={plot?.plotID}
              value={plot?.plotID}
            >
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ width: '100%' }} className="sidebar-item">
                <Stack direction="column" alignItems="start">
                  <Typography level="body-lg" data-testid="plot-selection-option-name">
                    {plot?.plotName}
                  </Typography>
                  <Typography level="body-sm" color="neutral">
                    {plot?.numQuadrats || plot?.numQuadrats === 0 ? `Quadrats: ${plot.numQuadrats}` : 'No Quadrats'}
                  </Typography>
                </Stack>
                {onPlotEdit && (
                  <IconButton
                    size="sm"
                    variant="plain"
                    color="neutral"
                    onClick={e => handleMenuOpen(e, plot)}
                    aria-label="Plot options"
                    data-testid="plot-option-menu-button"
                  >
                    <MoreHoriz />
                  </IconButton>
                )}
              </Stack>
            </Option>
          ))}
      </Select>

      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleMenuClose} placement="right-start" data-testid="plot-options-menu">
        <MenuItem onClick={handleEditPlot} data-testid="edit-plot-option">
          Edit Plot
        </MenuItem>
      </Menu>
    </>
  );
}
