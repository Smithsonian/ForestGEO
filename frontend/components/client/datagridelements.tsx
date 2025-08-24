// datagridelements.tsx
'use client';

import { ExtendedGridFilterModel, RowControl, VisibleFilter } from '@/config/datagridhelpers';
import {
  Badge,
  Box,
  Button,
  Chip,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormLabel,
  IconButton,
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
import { CallSplit, Forest, Grass, RuleOutlined, UnfoldLess, UnfoldMore } from '@mui/icons-material';

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
    hidingEmptyColumns?: boolean;
    handleToggleHideEmptyColumns?: (checked: boolean) => void;
    handleQuickFilterChange?: (incomingFilterModel: GridFilterModel) => void;
    filterModel?: ExtendedGridFilterModel;
    apiRef?: RefObject<GridApiCommunity>;
    dynamicButtons?: any;
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
    failedControls?: { trigger: () => void; count: number };
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
    handleQuickFilterChange,
    filterModel,
    dynamicButtons = [],
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
    setHidingEmpty,
    failedControls = {
      trigger: () => {},
      count: 0
    }
  } = props;
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
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [openExportModal, setOpenExportModal] = useState(false);
  const [exportType, setExportType] = useState<'csv' | 'form'>('csv');
  const [exportVisibility, setExportVisibility] = useState<VisibleFilter[]>(filterModel.visible);
  const apiRef = useGridApiContext();

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

  useEffect(() => {
    if (isTyping) {
      const timeout = setTimeout(() => setIsTyping(false), 2000);
      return () => clearTimeout(timeout);
    }
  }, [isTyping, inputValue]);

  function exportFilterModel() {
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
    // 2a) generic two-arg export
    if (handleExport) {
      const blob = new Blob([await handleExport(exportVisibility, exportType)], {
        type: 'text/csv;charset=utf-8;'
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `measurements_${exportType}_${currentSite?.schemaName ?? ''}_${currentPlot?.plotName ?? ''}_${currentCensus?.plotCensusNumber ?? 0}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
    // 2b) single-purpose CSV
    else if (handleExportCSV) {
      await handleExportCSV();
    }
    // 2c) “export all” fallback
    else {
      await handleExportAll!();
    }

    setOpenExportModal(false);
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
      <Toolbar color="primary" style={{ width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box
          sx={{
            display: 'flex',
            flex: 1,
            maxWidth: '100%',
            justifyContent: 'space-evenly',
            alignItems: 'center'
          }}
        >
          <Box sx={{ display: 'flex', flex: 1, width: '100%' }}>
            <Box display={'flex'} alignItems={'center'} sx={{ flex: 0.75, display: 'flex', justifyContent: 'space-evenly' }}>
              <ColumnsPanelTrigger
                style={{ flex: 0.5, display: 'flex', justifyContent: 'center', maxWidth: '15%' }}
                render={<ToolbarButton>Columns</ToolbarButton>}
              />
              <Divider orientation={'vertical'} sx={{ mx: 0.5 }} />
              <FilterPanelTrigger
                style={{ flex: 0.5, display: 'flex', justifyContent: 'center', maxWidth: '15%' }}
                render={<ToolbarButton>Filter</ToolbarButton>}
              />
              <Divider orientation={'vertical'} sx={{ mx: 0.5 }} />
              <Tooltip title={'Press Enter to apply filter'} open={isTyping} placement={'bottom'} arrow>
                <QuickFilter style={{ flex: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: '-20px' }}>
                  <QuickFilterControl
                    style={{ flex: 1, display: 'flex', justifyContent: 'center' }}
                    placeholder={'Search All Fields...'}
                    value={inputValue}
                    onKeyDown={handleKeyDown}
                    onChange={handleInputChange}
                    slotProps={{ input: { endAdornment: null } }}
                  />
                  <QuickFilterClear
                    aria-label={'clear filter'}
                    disabled={inputValue === ''}
                    onClick={handleClearInput}
                    size={'small'}
                    style={{ marginLeft: 1 }}
                  >
                    <Tooltip title={'Clear filter'} placement={'bottom'}>
                      <ClearIcon fontSize={'small'} />
                    </Tooltip>
                  </QuickFilterClear>
                </QuickFilter>
              </Tooltip>
            </Box>
            <Divider orientation={'vertical'} sx={{ mx: 1.5 }} />
            <Button
              style={{ display: 'flex', flex: 0.15, maxWidth: '15%', marginRight: '0.75%' }}
              color={'primary'}
              startDecorator={<RefreshIcon />}
              onClick={async () => await handleRefresh()}
            >
              Refresh
            </Button>
            {gridType === 'measurements' && (
              <Stack direction={'row'} gap={1} spacing={1} sx={{ display: 'flex', flex: 0.25, alignItems: 'center', justifyContent: 'center' }}>
                <Tooltip title={`Invalid: (${errorControls.count})`}>
                  <Badge badgeContent={errorControls.count} size={'sm'}>
                    <IconButton
                      disabled={!errorControls.count}
                      variant="soft"
                      color={errorControls.show ? 'danger' : 'neutral'}
                      onClick={() => errorControls.toggle(!errorControls.show)}
                    >
                      <CancelPresentationIcon />
                    </IconButton>
                  </Badge>
                </Tooltip>
                <Tooltip title={`Valid: (${validControls.count})`}>
                  <Badge badgeContent={validControls.count} size={'sm'}>
                    <IconButton
                      variant="soft"
                      disabled={!validControls.count}
                      color={validControls.show ? 'success' : 'neutral'}
                      onClick={() => validControls.toggle(!validControls.show)}
                    >
                      <VerifiedIcon />
                    </IconButton>
                  </Badge>
                </Tooltip>
                <Tooltip title={`Pending: (${pendingControls.count})`}>
                  <Badge badgeContent={pendingControls.count} size={'sm'}>
                    <IconButton
                      variant="soft"
                      disabled={!pendingControls.count}
                      color={pendingControls.show ? 'primary' : 'neutral'}
                      onClick={() => pendingControls.toggle(!pendingControls.show)}
                    >
                      <ScheduleIcon />
                    </IconButton>
                  </Badge>
                </Tooltip>
                <Tooltip title={`Old Trees: ${otControls.count}`}>
                  <Badge badgeContent={otControls.count} size={'sm'}>
                    <IconButton
                      variant="soft"
                      disabled={!otControls.count}
                      color={otControls.show ? 'primary' : 'neutral'}
                      onClick={() => otControls.toggle(!otControls.show)}
                    >
                      <Forest />
                    </IconButton>
                  </Badge>
                </Tooltip>
                <Tooltip title={`Multi-Stems: ${msControls.count}`}>
                  <Badge badgeContent={msControls.count} size={'sm'}>
                    <IconButton
                      variant="soft"
                      disabled={!msControls.count}
                      color={msControls.show ? 'primary' : 'neutral'}
                      onClick={() => msControls.toggle(!msControls.show)}
                    >
                      <CallSplit />
                    </IconButton>
                  </Badge>
                </Tooltip>
                <Tooltip title={`New Recruits: ${nrControls.count}`}>
                  <Badge badgeContent={nrControls.count} size={'sm'}>
                    <IconButton
                      variant="soft"
                      disabled={!nrControls.count}
                      color={nrControls.show ? 'primary' : 'neutral'}
                      onClick={() => nrControls.toggle(!nrControls.show)}
                    >
                      <Grass />
                    </IconButton>
                  </Badge>
                </Tooltip>
                <Tooltip title={`Unsubmitted: ${failedControls.count}`}>
                  <Badge badgeContent={failedControls.count} size={'sm'}>
                    <IconButton
                      variant="soft"
                      disabled={!failedControls.count}
                      color={failedControls.count ? 'primary' : 'neutral'}
                      onClick={failedControls.trigger}
                    >
                      <RuleOutlined />
                    </IconButton>
                  </Badge>
                </Tooltip>
              </Stack>
            )}
            <Divider orientation={'vertical'} sx={{ mx: 1.5 }} />
            <Stack
              direction={'row'}
              spacing={1}
              sx={{
                display: 'flex',
                flex: 0.5,
                alignItems: 'center',
                justifyContent: 'space-between',
                '& > *': {
                  flex: '1 1 0px',
                  display: 'flex',
                  justifyContent: 'center'
                }
              }}
            >
              {hasAnyExport && (
                <Tooltip title={'Export as CSV'} placement="top" arrow>
                  <IconButton
                    variant="soft"
                    color="primary"
                    onClick={async () => {
                      if (handleExport) {
                        setOpenExportModal(true);
                      } else if (handleExportCSV) {
                        await handleExportCSV();
                      } else {
                        await handleExportAll!();
                      }
                    }}
                  >
                    <CloudDownloadIcon />
                  </IconButton>
                </Tooltip>
              )}
              {dynamicButtons.map(
                (button: any, index: number) =>
                  button.tooltip && (
                    <Tooltip key={index} title={button.tooltip} placement="top" arrow color={'primary'} size={'lg'} variant={'solid'}>
                      {button.count ? (
                        <Badge badgeContent={button.count}>
                          {button.icon ? (
                            <IconButton
                              onClick={button.onClick}
                              variant="soft"
                              color="primary"
                              sx={theme => ({
                                flex: 1,
                                display: 'flex',
                                justifyContent: 'center',
                                width: theme.spacing(5),
                                height: theme.spacing(5),
                                padding: 0
                              })}
                            >
                              {button.icon}
                            </IconButton>
                          ) : (
                            <Button onClick={button.onClick} variant="soft" color="primary">
                              {button.label}
                            </Button>
                          )}
                        </Badge>
                      ) : (
                        <Box>
                          {button.icon ? (
                            <IconButton
                              onClick={button.onClick}
                              variant="soft"
                              color="primary"
                              sx={theme => ({
                                flex: 1,
                                display: 'flex',
                                justifyContent: 'center',
                                width: theme.spacing(5),
                                height: theme.spacing(5),
                                padding: 0
                              })}
                            >
                              {button.icon}
                            </IconButton>
                          ) : (
                            <Button onClick={button.onClick} variant="soft" color="primary">
                              {button.label}
                            </Button>
                          )}
                        </Box>
                      )}
                    </Tooltip>
                  )
              )}
              <Tooltip title={hidingEmpty ? `Click to show empty columns!` : `Click to hide empty columns!`}>
                <IconButton
                  variant="soft"
                  color={'primary'}
                  onClick={() => (setHidingEmpty ? setHidingEmpty(!hidingEmpty) : undefined)}
                  sx={theme => ({
                    flex: 1,
                    display: 'flex',
                    justifyContent: 'center',
                    width: theme.spacing(5),
                    height: theme.spacing(5),
                    padding: 0
                  })}
                >
                  {hidingEmpty ? <UnfoldLess sx={{ transform: 'rotate(-90deg)' }} /> : <UnfoldMore sx={{ transform: 'rotate(90deg)' }} />}
                </IconButton>
              </Tooltip>
            </Stack>
          </Box>
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
              role={'alertdialog'}
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
                    component={'div'}
                    role={'button'}
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
                    component={'div'}
                    role={'button'}
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
                    component={'div'}
                    role={'button'}
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
                  onClick={async () => {
                    await downloadExportedData();
                    setOpenExportModal(false);
                  }}
                  aria-label={'Export selected data/visibility and close the modal'}
                >
                  Export
                </Button>
                <Button aria-label={'Cancel the operation and close the modal'} onClick={() => setOpenExportModal(false)}>
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
