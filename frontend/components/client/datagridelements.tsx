// datagridelements.tsx
'use client';

import { DynamicButton, ExtendedGridFilterModel, RowControl, VisibleFilter } from '@/config/datagridhelpers';
import {
  Badge,
  Box,
  Button,
  Chip,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Dropdown,
  FormLabel,
  IconButton,
  ListItemDecorator,
  Menu,
  MenuButton,
  MenuItem,
  Modal,
  ModalDialog,
  Skeleton,
  Stack,
  Switch,
  Tooltip,
  Typography
} from '@mui/joy';
import {
  ColumnsPanelTrigger,
  FilterPanelTrigger,
  GridColDef,
  GridFilterModel,
  GridSlotProps,
  QuickFilter,
  QuickFilterClear,
  QuickFilterControl,
  Toolbar,
  ToolbarButton,
  useGridApiContext
} from '@mui/x-data-grid';
import { ClearIcon } from '@mui/x-date-pickers/icons';
import React, { Dispatch, RefObject, SetStateAction, useEffect, useState } from 'react';
import RefreshIcon from '@mui/icons-material/Refresh';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import GridOnIcon from '@mui/icons-material/GridOn';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import CheckIcon from '@mui/icons-material/Check';
import CancelPresentationIcon from '@mui/icons-material/CancelPresentation';
import VerifiedIcon from '@mui/icons-material/Verified';
import ScheduleIcon from '@mui/icons-material/Schedule';
import { FormType, getTableHeaders } from '@/config/macros/formdetails';
import { GridApiCommunity } from '@mui/x-data-grid/internals';
import { Plot, Site } from '@/config/sqlrdsdefinitions/zones';
import { OrgCensus } from '@/config/sqlrdsdefinitions/timekeeping';
import { CallSplit, Forest, Grass, MoreVert, RuleOutlined, UnfoldLess, UnfoldMore, Warning } from '@mui/icons-material';

export function debounce<T extends (...args: any[]) => void>(fn: T, delay: number): T {
  let timeoutId: ReturnType<typeof setTimeout>;
  return ((...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  }) as T;
}

declare module '@mui/x-data-grid' {
  interface ToolbarPropsOverrides {
    handleAddNewRow?: () => Promise<void>;
    handleRefresh?: () => Promise<void>;
    handleExport?: (visibility: VisibleFilter[], exportType: 'csv' | 'form') => Promise<string>;
    handleExportAll?: () => Promise<void>;
    handleExportCSV?: () => Promise<void>;
    showToolbarActions?: boolean;
    hidingEmptyColumns?: boolean;
    handleToggleHideEmptyColumns?: (checked: boolean) => void;
    handleQuickFilterChange?: (incomingFilterModel: GridFilterModel) => void;
    filterModel?: ExtendedGridFilterModel;
    apiRef?: RefObject<GridApiCommunity>;
    dynamicButtons?: DynamicButton[];
    validationMenu?: React.ReactNode;
    locked?: boolean;
    currentSite?: Site;
    currentPlot?: Plot;
    currentCensus?: OrgCensus;
    gridColumns?: GridColDef[];
    gridType?: string;
    errorControls?: RowControl;
    validControls?: RowControl;
    pendingControls?: RowControl;
    otControls?: RowControl;
    msControls?: RowControl;
    nrControls?: RowControl;
    hidingEmpty?: boolean;
    setHidingEmpty?: Dispatch<SetStateAction<boolean>>;
  }
}

const defaultControl: RowControl = {
  show: true,
  toggle: () => {},
  count: 0
};

export const EditToolbar = (props: GridSlotProps['toolbar']) => {
  const {
    handleAddNewRow,
    handleRefresh,
    handleExport,
    handleExportAll,
    handleExportCSV,
    showToolbarActions = true,
    handleQuickFilterChange,
    filterModel,
    dynamicButtons = [],
    validationMenu,
    currentSite,
    currentPlot,
    currentCensus,
    gridColumns,
    gridType,
    errorControls = defaultControl,
    validControls = defaultControl,
    pendingControls = defaultControl,
    otControls = defaultControl,
    msControls = defaultControl,
    nrControls = defaultControl,
    hidingEmpty,
    setHidingEmpty
  } = props;

  // Hooks must be called before any early returns
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [openExportModal, setOpenExportModal] = useState(false);
  const [exportType, setExportType] = useState<'csv' | 'form'>('csv');
  const [exportVisibility, setExportVisibility] = useState<VisibleFilter[]>(filterModel?.visible || []);
  const [isExporting, setIsExporting] = useState(false);
  const apiRef = useGridApiContext();

  useEffect(() => {
    if (isTyping) {
      const timeout = setTimeout(() => setIsTyping(false), 2000);
      return () => clearTimeout(timeout);
    }
  }, [isTyping, inputValue]);

  const hasAnyExport = typeof handleExport === 'function' || typeof handleExportAll === 'function' || typeof handleExportCSV === 'function';

  // only require add / refresh / quickFilter / model / columns
  if (
    typeof handleAddNewRow !== 'function' ||
    typeof handleRefresh !== 'function' ||
    typeof handleQuickFilterChange !== 'function' ||
    !filterModel ||
    !gridColumns
  ) {
    return null;
  }

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(event.target.value);
    setIsTyping(true);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      handleQuickFilterChange({
        ...filterModel,
        items: filterModel?.items || [],
        quickFilterValues: inputValue.split(' ') || []
      });
      setIsTyping(false);
    }
  };

  const handleClearInput = () => {
    setInputValue('');
    handleQuickFilterChange({
      ...filterModel,
      items: filterModel?.items || [],
      quickFilterValues: []
    });
    setIsTyping(false);
  };

  function _exportFilterModel() {
    const jsonData = JSON.stringify(filterModel, null, 2);
    const blob = new Blob([jsonData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = 'results.json';
    link.click();

    URL.revokeObjectURL(url);
  }

  const downloadExportedData = async () => {
    setIsExporting(true);
    try {
      // 2a) generic two-arg export
      if (handleExport) {
        const data = await handleExport(exportVisibility, exportType);
        const blob = new Blob([data], {
          type: 'text/csv;charset=utf-8;'
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `measurements_${exportType}_${currentSite?.schemaName ?? ''}_${currentPlot?.plotName ?? ''}_${currentCensus?.plotCensusNumber ?? 0}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }
      // 2b) single-purpose CSV
      else if (handleExportCSV) {
        await handleExportCSV();
      }
      // 2c) "export all" fallback
      else {
        await handleExportAll!();
      }
    } catch (error: any) {
      console.error('Export failed:', error);
      // Could add a snackbar notification here if available in props
      alert(`Export failed: ${error.message || 'Unknown error'}`);
    } finally {
      setIsExporting(false);
      setOpenExportModal(false);
    }
  };

  const handleChipToggle = (type: string) => {
    setExportVisibility(prev => (prev.includes(type as VisibleFilter) ? prev.filter(t => t !== (type as VisibleFilter)) : [...prev, type as VisibleFilter]));
  };

  const csvHeaders = gridColumns
    .filter(column => !Object.keys(apiRef.current.state.columns.columnVisibilityModel).includes(column.field))
    .map(column => column.field);

  let formHeaders: string[];
  gridType === 'alltaxonomiesview'
    ? (formHeaders = getTableHeaders(FormType.species).map(header => header.label))
    : gridType !== 'unifiedchangelog'
      ? (formHeaders = getTableHeaders(Object.values(FormType).includes(gridType as FormType) ? (gridType as FormType) : FormType.arcgis_xlsx).map(
          header => header.label
        ))
      : (formHeaders = []);

  return (
    <>
      <Toolbar color="primary" style={{ width: '100%', alignItems: 'center' }}>
        <Box
          sx={{
            display: 'flex',
            width: '100%',
            justifyContent: 'flex-start',
            alignItems: 'center',
            gap: 0.5,
            flexWrap: 'nowrap',
            overflowX: 'auto',
            '&::-webkit-scrollbar': {
              height: 4
            },
            '&::-webkit-scrollbar-thumb': {
              backgroundColor: 'rgba(255,255,255,0.3)',
              borderRadius: 2
            }
          }}
        >
          {/* Left section - filters and controls */}
          <Box display={'flex'} alignItems={'center'} sx={{ gap: 0.5, flex: 1, minWidth: 'max-content' }}>
            <Box display={'flex'} alignItems={'center'} sx={{ flex: 1, minWidth: 'max-content' }}>
              <ColumnsPanelTrigger
                style={{ display: 'flex', justifyContent: 'center', flexShrink: 0 }}
                render={<ToolbarButton style={{ paddingLeft: 16, paddingRight: 16 }}>Columns</ToolbarButton>}
              />
              <Divider orientation={'vertical'} sx={{ mx: 0.5, flexShrink: 0 }} />
              <FilterPanelTrigger
                style={{ display: 'flex', justifyContent: 'center', flexShrink: 0 }}
                render={<ToolbarButton style={{ paddingLeft: 16, paddingRight: 16 }}>Filter</ToolbarButton>}
              />
              <Divider orientation={'vertical'} sx={{ mx: 0.5, flexShrink: 0 }} />
              <Tooltip title={'Press Enter to apply filter'} open={isTyping} placement={'bottom'} arrow sx={{ flex: 1, minWidth: '150px', maxWidth: '400px' }}>
                <QuickFilter defaultExpanded style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                  <QuickFilterControl
                    style={{ display: 'flex', flex: 1, minWidth: '100px' }}
                    placeholder={'Search All Fields...'}
                    value={inputValue}
                    onKeyDown={handleKeyDown}
                    onChange={handleInputChange}
                    slotProps={{
                      input: {
                        endAdornment: null,
                        'aria-label': 'Quick search across all fields. Press Enter to apply filter.'
                      }
                    }}
                  />
                  <QuickFilterClear
                    aria-label={'clear filter'}
                    disabled={inputValue === ''}
                    onClick={handleClearInput}
                    size={'small'}
                    style={{ marginLeft: 4, flexShrink: 0 }}
                  >
                    <Tooltip title={'Clear filter'} placement={'bottom'}>
                      <ClearIcon fontSize={'small'} />
                    </Tooltip>
                  </QuickFilterClear>
                </QuickFilter>
              </Tooltip>
            </Box>
            <Divider orientation={'vertical'} sx={{ mx: 1, flexShrink: 0 }} />
            <ToolbarButton
              render={
                <Button
                  style={{ display: 'flex', minWidth: 'fit-content', flexShrink: 0 }}
                  color={'primary'}
                  startDecorator={<RefreshIcon />}
                  onClick={async () => await handleRefresh()}
                  data-testid="refresh-button"
                >
                  Refresh
                </Button>
              }
            />
            {gridType === 'measurements' && (
              <Stack direction={'row'} spacing={1.5} sx={{ display: 'flex', alignItems: 'center', ml: 1, flexWrap: 'nowrap', flexShrink: 0 }}>
                <Tooltip title={`Invalid: ${errorControls.count} (rows with unresolved errors)`}>
                  <Badge badgeContent={errorControls.count} size={'sm'}>
                    <ToolbarButton
                      disabled={!errorControls.count}
                      render={
                        <IconButton
                          disabled={!errorControls.count}
                          variant="soft"
                          color={errorControls.show ? 'danger' : 'neutral'}
                          onClick={() => errorControls.toggle(!errorControls.show)}
                          aria-label={`${errorControls.show ? 'Hide' : 'Show'} invalid measurements (${errorControls.count})`}
                          aria-pressed={errorControls.show}
                          data-testid="filter-errors"
                        >
                          <Warning />
                        </IconButton>
                      }
                    />
                  </Badge>
                </Tooltip>
                <Tooltip title={`Valid: (${validControls.count})`}>
                  <Badge badgeContent={validControls.count} size={'sm'}>
                    <ToolbarButton
                      disabled={!validControls.count}
                      render={
                        <IconButton
                          variant="soft"
                          disabled={!validControls.count}
                          color={validControls.show ? 'success' : 'neutral'}
                          onClick={() => validControls.toggle(!validControls.show)}
                          aria-label={`${validControls.show ? 'Hide' : 'Show'} valid measurements (${validControls.count})`}
                          aria-pressed={validControls.show}
                          data-testid="filter-valid"
                        >
                          <VerifiedIcon />
                        </IconButton>
                      }
                    />
                  </Badge>
                </Tooltip>
                <Tooltip title={`Pending: (${pendingControls.count})`}>
                  <Badge badgeContent={pendingControls.count} size={'sm'}>
                    <ToolbarButton
                      disabled={!pendingControls.count}
                      render={
                        <IconButton
                          variant="soft"
                          disabled={!pendingControls.count}
                          color={pendingControls.show ? 'primary' : 'neutral'}
                          onClick={() => pendingControls.toggle(!pendingControls.show)}
                          aria-label={`${pendingControls.show ? 'Hide' : 'Show'} pending measurements (${pendingControls.count})`}
                          aria-pressed={pendingControls.show}
                          data-testid="filter-pending"
                        >
                          <ScheduleIcon />
                        </IconButton>
                      }
                    />
                  </Badge>
                </Tooltip>
                <Tooltip title={`Old Trees: ${otControls.count}`}>
                  <Badge badgeContent={otControls.count} size={'sm'}>
                    <ToolbarButton
                      disabled={!otControls.count}
                      render={
                        <IconButton
                          variant="soft"
                          disabled={!otControls.count}
                          color={otControls.show ? 'primary' : 'neutral'}
                          onClick={() => otControls.toggle(!otControls.show)}
                          aria-label={`${otControls.show ? 'Hide' : 'Show'} old trees (${otControls.count})`}
                          aria-pressed={otControls.show}
                          data-testid="filter-ot"
                        >
                          <Forest />
                        </IconButton>
                      }
                    />
                  </Badge>
                </Tooltip>
                <Tooltip title={`Multi-Stems: ${msControls.count}`}>
                  <Badge badgeContent={msControls.count} size={'sm'}>
                    <ToolbarButton
                      disabled={!msControls.count}
                      render={
                        <IconButton
                          variant="soft"
                          disabled={!msControls.count}
                          color={msControls.show ? 'primary' : 'neutral'}
                          onClick={() => msControls.toggle(!msControls.show)}
                          aria-label={`${msControls.show ? 'Hide' : 'Show'} multi-stem trees (${msControls.count})`}
                          aria-pressed={msControls.show}
                          data-testid="filter-ms"
                        >
                          <CallSplit />
                        </IconButton>
                      }
                    />
                  </Badge>
                </Tooltip>
                <Tooltip title={`New Recruits: ${nrControls.count}`}>
                  <Badge badgeContent={nrControls.count} size={'sm'}>
                    <ToolbarButton
                      disabled={!nrControls.count}
                      render={
                        <IconButton
                          variant="soft"
                          disabled={!nrControls.count}
                          color={nrControls.show ? 'primary' : 'neutral'}
                          onClick={() => nrControls.toggle(!nrControls.show)}
                          aria-label={`${nrControls.show ? 'Hide' : 'Show'} new recruits (${nrControls.count})`}
                          aria-pressed={nrControls.show}
                          data-testid="filter-nr"
                        >
                          <Grass />
                        </IconButton>
                      }
                    />
                  </Badge>
                </Tooltip>
              </Stack>
            )}
          </Box>
          {showToolbarActions && (
            <>
              <Divider orientation={'vertical'} sx={{ mx: 1 }} />
              {/* Right section - action buttons */}
              <Stack direction="row" spacing={1} sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                {/* Manual Entry Form - icon only with tooltip */}
                {dynamicButtons
                  .filter((button: any) => button.label === 'Manual Entry Form')
                  .map((button: any, index: number) => (
                    <Tooltip key={index} title={button.tooltip || 'Manual Entry Form'} placement="top" arrow>
                      <ToolbarButton
                        render={
                          <IconButton onClick={button.onClick} variant="soft" color="primary" size="sm" aria-label="Manual Entry Form">
                            {button.icon}
                          </IconButton>
                        }
                      />
                    </Tooltip>
                  ))}
                {/* Upload - keep as button with text */}
                {dynamicButtons
                  .filter((button: any) => button.label === 'Upload')
                  .map((button: any, index: number) => (
                    <Tooltip key={index} title={button.tooltip} placement="top" arrow>
                      <ToolbarButton
                        render={
                          <Button onClick={button.onClick} variant="soft" color="primary" size="sm" startDecorator={button.icon} sx={{ whiteSpace: 'nowrap' }}>
                            {button.label}
                          </Button>
                        }
                      />
                    </Tooltip>
                  ))}
                {/* Export as CSV button */}
                {hasAnyExport && (
                  <Tooltip title="Export as CSV" placement="top" arrow>
                    <ToolbarButton
                      render={
                        <IconButton
                          onClick={async () => {
                            if (handleExport) {
                              setOpenExportModal(true);
                            } else if (handleExportCSV) {
                              await handleExportCSV();
                            } else {
                              await handleExportAll!();
                            }
                          }}
                          variant="soft"
                          color="primary"
                          aria-label="Export as CSV"
                        >
                          <CloudDownloadIcon />
                        </IconButton>
                      }
                    />
                  </Tooltip>
                )}
                {/* Show/Hide empty columns button */}
                {setHidingEmpty && (
                  <Tooltip title={hidingEmpty ? 'Show empty columns' : 'Hide empty columns'} placement="top" arrow>
                    <ToolbarButton
                      render={
                        <IconButton
                          onClick={() => setHidingEmpty(!hidingEmpty)}
                          variant="soft"
                          color="primary"
                          aria-label={hidingEmpty ? 'Show empty columns' : 'Hide empty columns'}
                        >
                          {hidingEmpty ? <UnfoldMore sx={{ transform: 'rotate(90deg)' }} /> : <UnfoldLess sx={{ transform: 'rotate(-90deg)' }} />}
                        </IconButton>
                      }
                    />
                  </Tooltip>
                )}
                {/* Kebab menu for additional actions */}
                <Dropdown>
                  <Tooltip title="More actions" placement="top" arrow>
                    <MenuButton
                      slots={{ root: Button }}
                      slotProps={{
                        root: {
                          variant: 'soft',
                          color: 'primary',
                          size: 'sm',
                          'aria-label': 'More actions',
                          startDecorator: <MoreVert />
                        }
                      }}
                    >
                      More
                    </MenuButton>
                  </Tooltip>
                  <Menu placement="bottom-end" sx={{ minWidth: 240, zIndex: 9999 }}>
                    {/* Other dynamic buttons (excluding Manual Entry Form and Upload) */}
                    {dynamicButtons
                      .filter((button: any) => button.label !== 'Manual Entry Form' && button.label !== 'Upload')
                      .map(
                        (button: any, index: number) =>
                          button.tooltip && (
                            <MenuItem key={index} onClick={button.onClick}>
                              <ListItemDecorator>{button.icon}</ListItemDecorator>
                              <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                                <Typography level="body-sm">{button.label}</Typography>
                                <Typography level="body-xs" sx={{ color: 'neutral.500' }}>
                                  {button.tooltip}
                                </Typography>
                              </Box>
                              {button.count !== undefined && button.count > 0 && <Badge badgeContent={button.count} size="sm" />}
                            </MenuItem>
                          )
                      )}
                    {validationMenu && (
                      <Box>
                        <Divider />
                        {validationMenu}
                      </Box>
                    )}
                  </Menu>
                </Dropdown>
              </Stack>
            </>
          )}
        </Box>
        {handleExport && (
          <Modal
            open={openExportModal}
            onClose={() => setOpenExportModal(false)}
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <ModalDialog
              role={'dialog'}
              aria-labelledby={'exporting-data'}
              aria-describedby={'export-description'}
              sx={{
                width: '90%',
                maxWidth: '60vh',
                maxHeight: '90vh',
                overflowY: 'auto',
                p: 3
              }}
            >
              <DialogTitle id={'exporting-data'}>Exporting Data</DialogTitle>
              <DialogContent
                id={'export-description'}
                sx={{
                  mt: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  flexGrow: 1,
                  overflowY: 'auto'
                }}
              >
                <Stack direction={'row'} sx={{ width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Stack direction={'column'}>
                    <Typography level={'body-md'}>Desired Format Type:</Typography>
                    <Typography level={'body-sm'}>You can export data in either of these formats:</Typography>
                    <Stack direction={'row'}>
                      <Chip>
                        <strong>Table CSV</strong>
                      </Chip>
                      <Chip>
                        <strong>Form CSV</strong>
                      </Chip>
                    </Stack>
                  </Stack>
                  <Switch
                    aria-label={'toggle whether to export as a CSV or a form'}
                    size={'lg'}
                    checked={exportType === 'csv'}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => (event.target.checked ? setExportType('csv') : setExportType('form'))}
                    endDecorator={
                      <Stack direction={'column'} sx={{ alignItems: 'center', justifyContent: 'center' }}>
                        <Skeleton loading={exportType !== 'csv'} variant={'circular'} width={'1.5em'} height={'1.5em'}>
                          <GridOnIcon />
                        </Skeleton>
                        <Typography level={'body-sm'}>
                          <Skeleton loading={exportType !== 'csv'}>CSV</Skeleton>
                        </Typography>
                      </Stack>
                    }
                    startDecorator={
                      <Stack direction={'column'} sx={{ alignItems: 'center', justifyContent: 'center' }}>
                        <Skeleton loading={exportType !== 'form'} variant={'circular'} width={'1.5em'} height={'1.5em'}>
                          <PictureAsPdfIcon />
                        </Skeleton>
                        <Typography level={'body-sm'}>
                          <Skeleton loading={exportType !== 'form'}>Form</Skeleton>
                        </Typography>
                      </Stack>
                    }
                    sx={{
                      marginRight: '1.5em',
                      transform: 'scale(1.25)',
                      transformOrigin: 'center'
                    }}
                  />
                </Stack>
                <Divider sx={{ my: 1 }} />
                <FormLabel id={'export-headers'} htmlFor={'display-export-headers'}>
                  Export Headers:
                </FormLabel>
                <Box
                  id={'display-export-headers'}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(125px, 0.5fr))',
                    gap: '0.5rem',
                    mb: 1,
                    width: '100%',
                    boxSizing: 'border-box'
                  }}
                >
                  {exportType === 'csv'
                    ? csvHeaders.map((header, index) => (
                        <Chip key={index} variant={'soft'} color={'primary'}>
                          {header}
                        </Chip>
                      ))
                    : formHeaders.map((label, index) => (
                        <Chip key={index} variant={'soft'} color={'primary'}>
                          {label}
                        </Chip>
                      ))}
                </Box>
                <Divider sx={{ my: 1 }} />
                <Typography level={'title-md'}>Please choose your desired visibility settings using the provided legend:</Typography>
                <Stack
                  direction={'row'}
                  sx={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'space-between',
                    gap: 1
                  }}
                >
                  <Chip
                    component={'button'}
                    type={'button'}
                    role={'checkbox'}
                    aria-checked={exportVisibility.includes('valid')}
                    tabIndex={0}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleChipToggle('valid');
                      }
                    }}
                    color={'success'}
                    size={'lg'}
                    aria-label={exportVisibility.includes('valid') ? 'Rows passing validation will be exported' : "Rows passing validation won't be exported"}
                    variant={exportVisibility.includes('valid') ? 'soft' : 'outlined'}
                    startDecorator={exportVisibility.includes('valid') ? <CheckIcon /> : undefined}
                    sx={{
                      flex: 1,
                      textAlign: 'center',
                      whiteSpace: 'normal',
                      wordBreak: 'break-word'
                    }}
                    onClick={() => handleChipToggle('valid')}
                  >
                    Rows passing validation
                  </Chip>
                  <Chip
                    component={'button'}
                    type={'button'}
                    role={'checkbox'}
                    aria-checked={exportVisibility.includes('errors')}
                    tabIndex={0}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleChipToggle('errors');
                      }
                    }}
                    color={'danger'}
                    size={'lg'}
                    variant={exportVisibility.includes('errors') ? 'soft' : 'outlined'}
                    aria-label={exportVisibility.includes('errors') ? 'Rows failing validation will be exported' : "Rows failing validation won't be exported"}
                    startDecorator={exportVisibility.includes('errors') ? <CheckIcon /> : undefined}
                    sx={{
                      flex: 1,
                      textAlign: 'center',
                      whiteSpace: 'normal',
                      wordBreak: 'break-word'
                    }}
                    onClick={() => handleChipToggle('errors')}
                  >
                    Rows failing validation
                  </Chip>
                  <Chip
                    component={'button'}
                    type={'button'}
                    role={'checkbox'}
                    aria-checked={exportVisibility.includes('pending')}
                    tabIndex={0}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleChipToggle('pending');
                      }
                    }}
                    color={'primary'}
                    size={'lg'}
                    variant={exportVisibility.includes('pending') ? 'soft' : 'outlined'}
                    aria-label={exportVisibility.includes('pending') ? 'Rows pending validation will be exported' : "Rows pending validation won't be exported"}
                    startDecorator={exportVisibility.includes('pending') ? <CheckIcon /> : undefined}
                    sx={{
                      flex: 1,
                      textAlign: 'center',
                      whiteSpace: 'normal',
                      wordBreak: 'break-word'
                    }}
                    onClick={() => handleChipToggle('pending')}
                  >
                    Rows pending validation
                  </Chip>
                </Stack>
              </DialogContent>
              <DialogActions>
                <Button
                  onClick={downloadExportedData}
                  disabled={isExporting}
                  startDecorator={isExporting ? <CircularProgress size="sm" /> : undefined}
                  aria-label={'Export selected data/visibility and close the modal'}
                >
                  {isExporting ? 'Exporting...' : 'Export'}
                </Button>
                <Button aria-label={'Cancel the operation and close the modal'} onClick={() => setOpenExportModal(false)} disabled={isExporting}>
                  Cancel
                </Button>
              </DialogActions>
            </ModalDialog>
          </Modal>
        )}
      </Toolbar>
    </>
  );
};
