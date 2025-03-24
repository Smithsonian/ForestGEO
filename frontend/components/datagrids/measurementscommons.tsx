// measurementcommons datagrid
'use client';
import React, { Dispatch, SetStateAction, useCallback, useEffect, useMemo, useState } from 'react';
import {
  GridActionsCellItem,
  GridCellParams,
  GridColDef,
  GridEventListener,
  GridFilterModel,
  GridRenderEditCellParams,
  GridRowEditStopReasons,
  GridRowId,
  GridRowModel,
  GridRowModes,
  GridRowModesModel,
  GridSortModel,
  GridToolbarColumnsButton,
  GridToolbarContainer,
  GridToolbarFilterButton,
  GridToolbarProps,
  GridToolbarQuickFilter,
  ToolbarPropsOverrides,
  useGridApiContext,
  useGridApiRef
} from '@mui/x-data-grid';
import { Alert, AlertColor, AlertProps, AlertPropsColorOverrides, Snackbar } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import Box from '@mui/joy/Box';
import {
  Button,
  Checkbox,
  Chip,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormLabel,
  IconButton,
  Input,
  Modal,
  ModalDialog,
  Skeleton,
  Stack,
  Switch,
  Tooltip,
  Typography
} from '@mui/joy';
import { StyledDataGrid } from '@/config/styleddatagrid';
import {
  CellItemContainer,
  createDeleteQuery,
  createPostPatchQuery,
  createQFFetchQuery,
  EditToolbarCustomProps,
  filterColumns,
  getColumnVisibilityModel,
  getGridID,
  MeasurementsCommonsProps,
  PendingAction,
  sortRowsByMeasurementDate
} from '@/config/datagridhelpers';
import { CMError, CoreMeasurementError, ErrorMap, ValidationPair } from '@/config/macros/uploadsystemmacros';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import { redirect } from 'next/navigation';
import moment from 'moment';
import CheckIcon from '@mui/icons-material/Check';
import ErrorIcon from '@mui/icons-material/Error';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import { bitToBoolean, HTTPResponses } from '@/config/macros';
import { useLoading } from '@/app/contexts/loadingprovider';
import { useSession } from 'next-auth/react';
import ConfirmationDialog from './confirmationdialog';
import { FormType, getTableHeaders } from '@/config/macros/formdetails';
import { applyFilterToColumns } from '@/components/datagrids/filtrationsystem';
import { ClearIcon } from '@mui/x-date-pickers';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import { InputChip, MeasurementsSummaryViewGridColumns } from '@/components/client/datagridcolumns';
import { OverridableStringUnion } from '@mui/types';
import ValidationOverrideModal from '@/components/client/validationoverridemodal';
import { MeasurementsSummaryResult } from '@/config/sqlrdsdefinitions/views';
import Divider from '@mui/joy/Divider';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import GridOnIcon from '@mui/icons-material/GridOn';
import MSVEditingModal from '@/components/datagrids/applications/msveditingmodal';
import MapperFactory from '@/config/datamapper';
import { AttributesRDS, AttributesResult } from '@/config/sqlrdsdefinitions/core';
import ValidationCore from '@/components/client/validationcore';
import { CloudSync, GppGoodOutlined, SettingsBackupRestoreRounded } from '@mui/icons-material';

function debounce<T extends (...args: any[]) => void>(fn: T, delay: number): T {
  let timeoutId: ReturnType<typeof setTimeout>;
  return ((...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  }) as T;
}

type EditToolbarProps = EditToolbarCustomProps & GridToolbarProps & ToolbarPropsOverrides;

type VisibleFilter = 'valid' | 'errors' | 'pending';

interface ExtendedGridFilterModel extends GridFilterModel {
  visible: VisibleFilter[];
}

const EditToolbar = (props: EditToolbarProps) => {
  const {
    handleAddNewRow,
    handleRefresh,
    handleExport,
    handleQuickFilterChange,
    filterModel,
    dynamicButtons = [],
    currentSite,
    currentPlot,
    currentCensus,
    gridColumns
  } = props;
  if (!handleAddNewRow || !handleExport || !handleRefresh || !handleQuickFilterChange || !filterModel || !gridColumns) return <></>;
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
  };

  const handleChipToggle = (type: string) => {
    setExportVisibility(prev => (prev.includes(type as VisibleFilter) ? prev.filter(t => t !== (type as VisibleFilter)) : [...prev, type as VisibleFilter]));
  };

  const csvHeaders = gridColumns
    .filter(column => !Object.keys(apiRef.current.state.columns.columnVisibilityModel).includes(column.field))
    .map(column => column.field);

  return (
    <>
      <GridToolbarContainer>
        <Box
          sx={{
            display: 'flex',
            flex: 1,
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: 'warning.main',
            borderRadius: '4px',
            p: 2
          }}
        >
          <Box sx={{ display: 'flex', flex: 1 }}>
            <Tooltip title={'Press Enter to apply filter'} open={isTyping} placement={'bottom'} arrow>
              <Box display={'flex'} alignItems={'center'}>
                <GridToolbarColumnsButton />
                <GridToolbarFilterButton />
                <GridToolbarQuickFilter
                  sx={{ ml: 2 }}
                  variant={'outlined'}
                  value={inputValue}
                  onKeyDown={handleKeyDown}
                  onChange={handleInputChange}
                  placeholder={'Search All Fields...'}
                  slotProps={{
                    input: {
                      endAdornment: null
                    }
                  }}
                />
                <Tooltip title={'Clear filter'} placement={'bottom'}>
                  <IconButton aria-label={'clear filter'} disabled={inputValue === ''} onClick={handleClearInput} size={'sm'} sx={{ marginLeft: 1 }}>
                    <ClearIcon fontSize={'small'} />
                  </IconButton>
                </Tooltip>
              </Box>
            </Tooltip>
            <Button
              color={'primary'}
              variant={'plain'}
              startDecorator={<RefreshIcon />}
              onClick={async () => await handleRefresh()}
              sx={{
                margin: 1
              }}
            >
              Refresh
            </Button>
            <Stack direction={'row'} spacing={2} sx={{ alignItems: 'center', justifyContent: 'center' }}>
              <Tooltip title={'Export as CSV'} placement="top" arrow>
                <IconButton
                  variant={'soft'}
                  color={'primary'}
                  onClick={() => setOpenExportModal(true)}
                  sx={theme => ({
                    width: theme.spacing(5),
                    height: theme.spacing(5),
                    padding: 0
                  })}
                >
                  <CloudDownloadIcon />
                </IconButton>
              </Tooltip>
              {dynamicButtons.map(
                (button: any, index: number) =>
                  button.tooltip && (
                    <Tooltip key={index} title={button.tooltip} placement="top" arrow color={'primary'} size={'lg'} variant={'solid'}>
                      {button.icon ? (
                        <IconButton
                          onClick={button.onClick}
                          variant="soft"
                          color="primary"
                          sx={theme => ({
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
                    </Tooltip>
                  )
              )}
            </Stack>
          </Box>
        </Box>
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
            <DialogTitle>
              <Typography level={'h3'}>Exporting Data</Typography>
            </DialogTitle>
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
              <FormLabel>Export Headers:</FormLabel>
              <Box
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
                  : getTableHeaders(FormType.measurements)
                      .map(header => header.label)
                      .map((label, index) => (
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
      </GridToolbarContainer>
    </>
  );
};

function EditMeasurements({ params }: { params: GridRenderEditCellParams }) {
  const initialValue = params.value ? Number(params.value).toFixed(2) : '0.00';
  const [value, setValue] = useState(initialValue);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.value;

    if (/^\d*\.?\d{0,2}$/.test(newValue) || newValue === '') {
      setValue(newValue);
    }
  };

  const handleBlur = () => {
    const formattedValue = parseFloat(value).toFixed(2);
    params.api.setEditCellValue({ id: params.id, field: params.field, value: parseFloat(formattedValue) });
  };

  return <Input autoFocus value={value} onChange={handleChange} onBlur={handleBlur} size="sm" sx={{ width: '100%', height: '100%' }} type="text" />;
}

export default function MeasurementsCommons(props: Readonly<MeasurementsCommonsProps>) {
  const {
    addNewRowToGrid,
    gridType,
    gridColumns,
    rows = [],
    setRows,
    rowCount,
    setRowCount,
    rowModesModel,
    setRowModesModel,
    snackbar,
    setSnackbar,
    refresh,
    setRefresh,
    paginationModel,
    setPaginationModel,
    isNewRowAdded,
    setIsNewRowAdded,
    setShouldAddRowAfterFetch,
    handleSelectQuadrat,
    locked = false,
    dynamicButtons
  } = props;

  const [newLastPage, setNewLastPage] = useState<number | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>({
    actionType: '',
    actionId: null
  });
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isValidationModalOpen, setIsValidationModalOpen] = useState(false);
  const [isValidationOverrideModalOpen, setIsValidationOverrideModalOpen] = useState(false);
  const [isResetValidationModalOpen, setIsResetValidationModalOpen] = useState(false);
  const [promiseArguments, setPromiseArguments] = useState<{
    resolve: (value: GridRowModel) => void;
    reject: (reason?: any) => void;
    newRow: GridRowModel;
    oldRow: GridRowModel;
  } | null>(null);
  const [usingQuery, setUsingQuery] = useState('');
  const [isSaveHighlighted, setIsSaveHighlighted] = useState(false);

  const [validationErrors, setValidationErrors] = useState<ErrorMap>({});
  const [showErrorRows, setShowErrorRows] = useState<boolean>(true);
  const [showValidRows, setShowValidRows] = useState<boolean>(true);
  const [showPendingRows, setShowPendingRows] = useState<boolean>(true);
  const [hidingEmpty, setHidingEmpty] = useState(true);
  const [filterModel, setFilterModel] = useState<ExtendedGridFilterModel>({
    items: [],
    quickFilterValues: [],
    visible: [
      ...(showErrorRows ? (['errors'] as VisibleFilter[]) : []),
      ...(showValidRows ? (['valid'] as VisibleFilter[]) : []),
      ...(showPendingRows ? (['pending'] as VisibleFilter[]) : [])
    ]
  });
  const [sortModel, setSortModel] = useState<GridSortModel>([{ field: 'measurementDate', sort: 'asc' }]);
  const [errorCount, setErrorCount] = useState<number | null>(null);
  const [validCount, setValidCount] = useState<number | null>(null);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [selectableAttributes, setSelectableAttributes] = useState<string[]>([]);
  const [reloadAttrs, setReloadAttrs] = useState(true);

  // context pulls and definitions
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const { setLoading } = useLoading();
  // use the session
  const { data: session } = useSession();

  const apiRef = useGridApiRef();

  useEffect(() => {
    setFilterModel(prevModel => ({
      ...prevModel,
      visible: [
        ...(showErrorRows ? (['errors'] as VisibleFilter[]) : []),
        ...(showValidRows ? (['valid'] as VisibleFilter[]) : []),
        ...(showPendingRows ? (['pending'] as VisibleFilter[]) : [])
      ]
    }));
    setRefresh(true);
  }, [showErrorRows, showValidRows, showPendingRows]);

  useEffect(() => {
    if (refresh) {
      runFetchPaginated().then(() => setRefresh(false));
    }
    console.log(rows);
  }, [refresh]);

  useEffect(() => {
    async function reloadAttributes() {
      const response = await fetch(`/api/runquery`, {
        method: 'POST',
        body: JSON.stringify(`SELECT * FROM ${currentSite?.schemaName}.attributes;`)
      });
      const data = MapperFactory.getMapper<AttributesRDS, AttributesResult>('attributes').mapData(await response.json());
      setSelectableAttributes(data.map(i => i.code).filter((code): code is string => code !== undefined));
      setReloadAttrs(false);
    }

    reloadAttributes().catch(console.error);
  }, []);
  // helper functions for usage:
  const handleSortModelChange = (newModel: GridSortModel) => {
    setSortModel(newModel);

    if (newModel.length > 0) {
      const { field, sort } = newModel[0];
      if (field === 'measurementDate') {
        const sortedRows = sortRowsByMeasurementDate(rows, sort);
        setRows(sortedRows);
      }
    }
  };

  const cellHasError = (colField: string, rowId: GridRowId) => {
    const row = rows.find(row => rowId === row.id);
    if (!row || !row.coreMeasurementID || !validationErrors[row.coreMeasurementID]) {
      return false;
    }
    return validationErrors[Number(row.coreMeasurementID)].errors.find(error => error.validationPairs.find(vp => vp.criterion === colField));
  };

  const rowHasError = (rowId: GridRowId) => {
    const row = rows.find(row => rowId === row.id);
    if (!row || !row.coreMeasurementID || !validationErrors[row.coreMeasurementID]) {
      return false; // No errors for this row
    }
    return gridColumns.some(column => cellHasError(column.field, rowId));
  };

  const fetchRowsForExport = async (visibility: VisibleFilter[], exportType: 'csv' | 'form') => {
    const tempFilter: ExtendedGridFilterModel = {
      ...filterModel,
      visible: visibility
    };
    if (exportType === 'form') {
      const response = await fetch(
        `/api/formdownload/measurements/${currentSite?.schemaName ?? ''}/${currentPlot?.plotID ?? 0}/${currentCensus?.dateRanges[0].censusID ?? 0}/${JSON.stringify(tempFilter)}`,
        { method: 'GET' }
      );
      const data = await response.json();
      let csvRows =
        getTableHeaders(FormType.measurements)
          .map(row => row.label)
          .join(',') + '\n';
      data.forEach((row: any) => {
        const values = getTableHeaders(FormType.measurements)
          .map(rowHeader => rowHeader.label)
          .map(header => row[header])
          .map(value => {
            if (value === undefined || value === null || value === '') {
              return null;
            }
            const match = value.match(/(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})|(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);

            if (match) {
              let normalizedDate;
              if (match[1]) {
                normalizedDate = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
              } else {
                normalizedDate = `${match[6]}-${match[5].padStart(2, '0')}-${match[4].padStart(2, '0')}`;
              }

              const parsedDate = moment(normalizedDate, 'YYYY-MM-DD', true);
              if (parsedDate.isValid()) {
                return parsedDate.format('YYYY-MM-DD');
              }
            }
            if (/^0[0-9]+$/.test(value)) {
              return value; // Return as a string if it has leading zeroes
            }
            // Attempt to parse as a float
            const parsedValue = parseFloat(value);
            if (!isNaN(parsedValue)) {
              return parsedValue;
            }
            if (typeof value === 'string') {
              value = value.replace(/"/g, '""');
              value = `"${value}"`;
            }

            return value;
          });
        csvRows += values.join(',') + '\n';
      });
      return csvRows;
    } else {
      const tempQuery = createQFFetchQuery(
        currentSite?.schemaName ?? '',
        gridType,
        paginationModel.page,
        paginationModel.pageSize,
        currentPlot?.plotID,
        currentCensus?.plotCensusNumber
      );

      const results: MeasurementsSummaryResult[] = await (
        await fetch(`/api/runquery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            (
              await (
                await fetch(tempQuery, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ filterModel: tempFilter })
                })
              ).json()
            ).finishedQuery
              .replace(/\bSQL_CALC_FOUND_ROWS\b\s*/i, '')
              .replace(/\bLIMIT\s+\d+\s*,\s*\d+/i, '')
              .trim()
          )
        })
      ).json();
      const headers = Object.keys(results[0]).filter(
        header => !['CoreMeasurementID', 'StemID', 'TreeID', 'SpeciesID', 'QuadratID', 'PlotID', 'CensusID'].includes(header)
      );
      let csvRows = headers.join(',') + '\n';
      Object.entries(results).forEach(([_, row]) => {
        const rowValues = headers.map(header => {
          if (header === 'IsValidated') return bitToBoolean(row[header]);
          if (header === 'MeasurementDate') return moment(new Date(row[header as keyof MeasurementsSummaryResult])).format('YYYY-MM-DD');
          if (Object.prototype.toString.call(row[header as keyof MeasurementsSummaryResult]) === '[object Object]')
            return `"${JSON.stringify(row[header as keyof MeasurementsSummaryResult]).replace(/"/g, '""')}"`;
          const value = row[header as keyof MeasurementsSummaryResult];
          if (typeof value === 'string' && value.includes(',')) return `"${value.replace(/"/g, '""')}"`;
          return value ?? 'NULL';
        });
        csvRows += rowValues.join(',') + '\n';
      });
      return csvRows;
    }
  };

  const updateRow = async (
    gridType: string,
    schemaName: string | undefined,
    newRow: GridRowModel,
    oldRow: GridRowModel,
    setSnackbar: Dispatch<SetStateAction<Pick<AlertProps, 'children' | 'severity'> | null>>,
    setIsNewRowAdded: (value: boolean) => void,
    setShouldAddRowAfterFetch: (value: boolean) => void,
    fetchPaginatedData: (page: number) => Promise<void>,
    paginationModel: { page: number }
  ): Promise<GridRowModel> => {
    const gridID = getGridID(gridType);
    const fetchProcessQuery = createPostPatchQuery(schemaName ?? '', gridType, gridID);
    newRow.measurementDate = moment(newRow.measurementDate).format('YYYY-MM-DD');
    newRow.userDefinedFields = JSON.stringify(newRow.userDefinedFields);
    try {
      const response = await fetch(fetchProcessQuery, {
        method: oldRow.isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldRow: oldRow, newRow: newRow })
      });

      const responseJSON = await response.json();

      if (!response.ok) {
        setSnackbar({
          children: `Error: ${responseJSON.message}`,
          severity: 'error'
        });
        return Promise.reject(responseJSON.row);
      }

      setSnackbar({
        children: oldRow.isNew ? 'New row added!' : 'Row updated!',
        severity: 'success'
      });

      if (oldRow.isNew) {
        setIsNewRowAdded(false);
        setShouldAddRowAfterFetch(false);
        await fetchPaginatedData(paginationModel.page);
        await fetchValidationErrors();
      }

      return newRow;
    } catch (error: any) {
      setSnackbar({ children: `Error: ${error.message}`, severity: 'error' });
      return Promise.reject(newRow);
    }
  };

  const openConfirmationDialog = (actionType: 'save' | 'delete', actionId: GridRowId) => {
    setPendingAction({ actionType, actionId });
    const row = rows.find(row => String(row.id) === String(actionId));
    if (row) {
      if (actionType === 'delete') {
        setIsDeleteDialogOpen(true);
      } else {
        setIsDialogOpen(true);
        setRowModesModel(oldModel => ({
          ...oldModel,
          [actionId]: { mode: GridRowModes.View }
        }));
      }
    }
  };

  const handleConfirmAction = async () => {
    setIsDialogOpen(false);
    setIsDeleteDialogOpen(false);
    if (pendingAction.actionType === 'save' && pendingAction.actionId !== null && promiseArguments) {
      await performSaveAction(pendingAction.actionId);
    } else if (pendingAction.actionType === 'delete' && pendingAction.actionId !== null) {
      await performDeleteAction(pendingAction.actionId);
    }
    setPendingAction({ actionType: '', actionId: null });
    setPromiseArguments(null); // Clear promise arguments after handling
  };

  const handleCancelAction = () => {
    setIsDialogOpen(false);
    setIsDeleteDialogOpen(false);
    if (promiseArguments) {
      promiseArguments.reject(new Error('Action cancelled by user'));
    }
    setPendingAction({ actionType: '', actionId: null });
    setPromiseArguments(null); // Clear promise arguments after handling
  };

  const performSaveAction = async (id: GridRowId) => {
    if (locked || !promiseArguments) return;
    setLoading(true, 'Saving changes...');
    try {
      const updatedRow = await updateRow(
        gridType,
        currentSite?.schemaName,
        promiseArguments.newRow,
        promiseArguments.oldRow,
        setSnackbar,
        setIsNewRowAdded,
        setShouldAddRowAfterFetch,
        fetchPaginatedData,
        paginationModel
      );
      promiseArguments.resolve(updatedRow);
    } catch (error) {
      promiseArguments.reject(error);
    }
    const row = rows.find(row => String(row.id) === String(id));
    if (row?.isNew) {
      setIsNewRowAdded(false);
      setShouldAddRowAfterFetch(false);
    }
    if (handleSelectQuadrat) handleSelectQuadrat(null);
    setLoading(false);
    if (reloadAttrs) {
      const response = await fetch(`/api/runquery`, {
        method: 'POST',
        body: JSON.stringify(`SELECT * FROM ${currentSite?.schemaName}.attributes;`)
      });
      const data = MapperFactory.getMapper<AttributesRDS, AttributesResult>('attributes').mapData(await response.json());
      setSelectableAttributes(data.map(i => i.code).filter((code): code is string => code !== undefined));
      setReloadAttrs(false);
    }
    try {
      setLoading(true, 'Refreshing Measurements Summary View...');
      const response = await fetch(`/api/refreshviews/measurementssummary/${currentSite?.schemaName ?? ''}`, { method: 'POST' });
      if (!response.ok) throw new Error('Measurements Summary View Refresh failure');
      await new Promise(resolve => setTimeout(resolve, 500));
      setLoading(true, 'Re-fetching paginated data...');
      await fetchPaginatedData(paginationModel.page);
      await new Promise(resolve => setTimeout(resolve, 500));
      setLoading(true, 'Reloading validation errors');
      await fetchValidationErrors();
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (e: any) {
      console.error(e);
    } finally {
      await new Promise(resolve => setTimeout(resolve, 1000));
      setLoading(false);
      setRefresh(true);
    }
  };

  const performDeleteAction = async (id: GridRowId) => {
    if (locked) return;
    setLoading(true, 'Deleting...');
    const deletionID = rows.find(row => String(row.id) === String(id))?.id;
    if (!deletionID) return;
    const deleteQuery = createDeleteQuery(currentSite?.schemaName ?? '', gridType, getGridID(gridType), deletionID);
    const response = await fetch(deleteQuery, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        oldRow: undefined,
        newRow: rows.find(row => String(row.id) === String(id))!
      })
    });
    setLoading(false);
    if (!response.ok) {
      const error = await response.json();
      if (response.status === HTTPResponses.FOREIGN_KEY_CONFLICT) {
        setSnackbar({
          children: `Error: Cannot delete row due to foreign key constraint in table ${error.referencingTable}`,
          severity: 'error'
        });
      } else {
        setSnackbar({
          children: `Error: ${error.message || 'Deletion failed'}`,
          severity: 'error'
        });
      }
    } else {
      if (handleSelectQuadrat) handleSelectQuadrat(null);
      setSnackbar({
        children: 'Row successfully deleted',
        severity: 'success'
      });
      setRows(rows.filter(row => String(row.id) !== String(id)));
      try {
        setLoading(true, 'Refreshing Measurements Summary View...');
        const response = await fetch(`/api/refreshviews/measurementssummary/${currentSite?.schemaName ?? ''}`, { method: 'POST' });
        if (!response.ok) throw new Error('Measurements Summary View Refresh failure');
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (e: any) {
        console.error(e);
      } finally {
        setLoading(false);
      }
      await new Promise(resolve => setTimeout(resolve, 1000)); // forced delay
      await fetchPaginatedData(paginationModel.page);
    }
  };

  const handleSaveClick = (id: GridRowId) => () => {
    if (locked) return;
    openConfirmationDialog('save', id);
  };

  const handleDeleteClick = (id: GridRowId) => () => {
    if (locked) return;
    openConfirmationDialog('delete', id);
  };

  const handleAddNewRow = async () => {
    if (locked) {
      return;
    }
    const newRowCount = rowCount + 1;
    const calculatedNewLastPage = Math.ceil(newRowCount / paginationModel.pageSize) - 1;
    const existingLastPage = Math.ceil(rowCount / paginationModel.pageSize) - 1;
    const isNewPageNeeded = newRowCount % paginationModel.pageSize === 1;

    setIsNewRowAdded(true);
    setShouldAddRowAfterFetch(isNewPageNeeded);
    setNewLastPage(calculatedNewLastPage);

    if (isNewPageNeeded) {
      setPaginationModel({ ...paginationModel, page: calculatedNewLastPage });
      addNewRowToGrid();
    } else {
      setPaginationModel({ ...paginationModel, page: existingLastPage });
      addNewRowToGrid();
    }
  };

  const fetchPaginatedData = useCallback(
    debounce(async (pageToFetch: number) => {
      if (!currentSite || !currentPlot || !currentCensus) {
        console.warn('Missing necessary context for fetchPaginatedData');
        return;
      }

      setLoading(true);
      let paginatedQuery = '';

      paginatedQuery = createQFFetchQuery(
        currentSite?.schemaName ?? '',
        gridType,
        pageToFetch,
        paginationModel.pageSize,
        currentPlot?.plotID,
        currentCensus?.plotCensusNumber
      );

      try {
        const { items, ...rest } = filterModel;
        const response = await fetch(paginatedQuery, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: filterModel.items.every(item => item.value && item.operator && item.field && item.operator !== '' && item.field !== '')
            ? JSON.stringify({ filterModel })
            : JSON.stringify({ filterModel: rest })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Error fetching data');

        setRows(data.output);
        setRowCount(data.totalCount);
        setUsingQuery(data.finishedQuery);

        if (isNewRowAdded && pageToFetch === newLastPage) {
          await handleAddNewRow();
        }
      } catch (error) {
        console.error('Error fetching data:', error);
        setSnackbar({ children: 'Error fetching data', severity: 'error' });
      } finally {
        setLoading(false);
      }
    }, 250),
    [filterModel, currentSite, currentPlot, currentCensus, paginationModel, isNewRowAdded, newLastPage]
  );

  async function runFetchPaginated() {
    await fetchPaginatedData(paginationModel.page);
    await fetchValidationErrors();
  }

  useEffect(() => {
    if (currentPlot && currentCensus && paginationModel.page >= 0) {
      runFetchPaginated().catch(console.error);
    }
  }, [currentPlot, currentCensus, paginationModel, rowCount, sortModel, isNewRowAdded, filterModel]);

  useEffect(() => {
    console.log('row count updated: ', rowCount);
  }, [rowCount]);

  useEffect(() => {
    async function getCounts() {
      const query = `SELECT SUM(CASE WHEN vft.IsValidated = TRUE THEN 1 ELSE 0 END)  AS CountValid,
                            SUM(CASE WHEN vft.IsValidated = FALSE THEN 1 ELSE 0 END) AS CountErrors,
                            SUM(CASE WHEN vft.IsValidated IS NULL THEN 1 ELSE 0 END) AS CountPending
                     FROM ${currentSite?.schemaName ?? ''}.${gridType} vft
                            JOIN ${currentSite?.schemaName ?? ''}.census c ON vft.PlotID = c.PlotID AND vft.CensusID = c.CensusID
                     WHERE vft.PlotID = ${currentPlot?.plotID ?? 0}
                       AND c.PlotID = ${currentPlot?.plotID ?? 0}
                       AND c.PlotCensusNumber = ${currentCensus?.plotCensusNumber ?? 0}`;
      const response = await fetch(`/api/runquery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(query)
      });
      if (!response.ok) throw new Error('measurementscommons failure. runquery execution for errorRowCount failed.');
      const data = await response.json();
      return data[0];
    }

    getCounts().then(data => {
      setValidCount(data.CountValid);
      setErrorCount(data.CountErrors);
      setPendingCount(data.CountPending);
      const counts = [
        { count: data.CountErrors, message: `${data.CountErrors} row(s) with validation errors detected.`, severity: 'warning' },
        { count: data.CountPending, message: `${data.CountPending} row(s) pending validation.`, severity: 'info' },
        { count: data.CountValid, message: `${data.CountValid} row(s) passed validation.`, severity: 'success' }
      ];
      const highestCount = counts.reduce((prev, current) => (current.count > prev.count ? current : prev));
      if (highestCount.count !== null) {
        setSnackbar({
          children: highestCount.message,
          severity: highestCount.severity as OverridableStringUnion<AlertColor, AlertPropsColorOverrides> | undefined
        });
      }
    });
  }, [rows, paginationModel]);

  const processRowUpdate = useCallback(
    (newRow: GridRowModel, oldRow: GridRowModel) =>
      new Promise<GridRowModel>((resolve, reject) => {
        setLoading(true, 'Processing changes...');
        if (newRow.id === '') {
          setLoading(false);
          return reject(new Error('Primary key id cannot be empty!'));
        }

        setPromiseArguments({ resolve, reject, newRow, oldRow });
        setLoading(false);
      }),
    [currentSite?.schemaName, setSnackbar, setIsNewRowAdded, setShouldAddRowAfterFetch, paginationModel]
  );

  const handleRowModesModelChange = (newRowModesModel: GridRowModesModel) => {
    setRowModesModel(newRowModesModel);
  };

  const handleRowCountChange = (newRowCountChange: number) => {
    setRowCount(newRowCountChange);
  };

  const handleCloseSnackbar = () => setSnackbar(null);

  const handleRowEditStop: GridEventListener<'rowEditStop'> = (params, event) => {
    if (params.reason === GridRowEditStopReasons.rowFocusOut) {
      event.defaultMuiPrevented = true;
    }
  };

  const handleEditClick = (id: GridRowId) => () => {
    if (locked) return;
    const row = rows.find(r => r.id === id);
    if (row && handleSelectQuadrat) {
      handleSelectQuadrat(row.quadratID);
    }
    setRowModesModel({ ...rowModesModel, [id]: { mode: GridRowModes.Edit } });
  };

  const handleCancelClick = (id: GridRowId, event?: React.MouseEvent) => {
    if (locked) return;
    event?.preventDefault();
    const row = rows.find(r => r.id === id);
    if (row?.isNew) {
      setRows(oldRows => oldRows.filter(row => row.id !== id));
      setIsNewRowAdded(false);
      if (rowCount % paginationModel.pageSize === 1 && isNewRowAdded) {
        const newPage = paginationModel.page - 1 >= 0 ? paginationModel.page - 1 : 0;
        setPaginationModel({ ...paginationModel, page: newPage });
      }
    } else {
      setRowModesModel(oldModel => ({
        ...oldModel,
        [id]: { mode: GridRowModes.View, ignoreModifications: true }
      }));
    }
    if (handleSelectQuadrat) handleSelectQuadrat(null);
  };

  const getEnhancedCellAction = (type: string, icon: any, onClick: any) => (
    <CellItemContainer>
      <Tooltip
        disableInteractive
        title={
          type === 'Save'
            ? `Save your changes`
            : type === 'Cancel'
              ? `Cancel your changes`
              : type === 'Edit'
                ? `Edit this row`
                : type === 'Delete'
                  ? 'Delete this row (cannot be undone!)'
                  : undefined
        }
        arrow
        placement="top"
      >
        <GridActionsCellItem icon={icon} label={type} onClick={onClick} />
      </Tooltip>
    </CellItemContainer>
  );

  function getGridActionsColumn(): GridColDef {
    return {
      field: 'actions',
      type: 'actions',
      headerName: 'Actions',
      width: 100,
      cellClassName: 'actions',
      getActions: ({ id }) => {
        const isInEditMode = rowModesModel[id]?.mode === 'edit';

        if (isInEditMode) {
          return [
            getEnhancedCellAction('Save', <SaveIcon />, handleSaveClick(id)),
            getEnhancedCellAction('Cancel', <CancelIcon />, (e: any) => handleCancelClick(id, e))
          ];
        }

        return [getEnhancedCellAction('Edit', <EditIcon />, handleEditClick(id)), getEnhancedCellAction('Delete', <DeleteIcon />, handleDeleteClick(id))];
      }
    };
  }

  const fetchValidationErrors = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/validations/validationerrordisplay?schema=${currentSite?.schemaName ?? ''}&plotIDParam=${currentPlot?.plotID ?? ''}&censusPCNParam=${currentCensus?.plotCensusNumber ?? ''}`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch validation errors');
      }

      const data = await response.json();
      const errorMap: ErrorMap = Array.isArray(data?.failed as CMError[])
        ? (data.failed as CMError[]).reduce<Record<number, CoreMeasurementError>>((acc, error) => {
            if (error.coreMeasurementID) {
              const errorDetailsMap = new Map<number, ValidationPair[]>();

              (error.validationErrorIDs || []).forEach((id, index) => {
                const descriptions = error.descriptions?.[index]?.split(';') || [];
                const criteria = error.criteria?.[index]?.split(';') || [];

                // Ensure descriptions and criteria are paired correctly
                const validationPairs = descriptions.map((description, i) => ({
                  description,
                  criterion: criteria[i] ?? '' // Default to empty if criteria is missing
                }));

                if (!errorDetailsMap.has(id)) {
                  errorDetailsMap.set(id, []);
                }

                // Append validation pairs to the corresponding ID
                errorDetailsMap.get(id)!.push(...validationPairs);
              });

              acc[error.coreMeasurementID] = {
                coreMeasurementID: error.coreMeasurementID,
                errors: Array.from(errorDetailsMap.entries()).map(([id, validationPairs]) => ({
                  id,
                  validationPairs
                }))
              };
            }
            return acc;
          }, {})
        : {};
      setValidationErrors(errorMap);
    } catch (error) {
      console.error('Error fetching validation errors:', error);
    }
  }, [currentSite?.schemaName]);

  // custom column formatting:
  const validationStatusColumn: GridColDef = useMemo(
    () => ({
      field: 'isValidated',
      headerName: '',
      headerAlign: 'center',
      align: 'center',
      width: 50,
      filterable: false,
      renderCell: (params: GridCellParams) => {
        if (validationErrors[Number(params.row.coreMeasurementID)]) {
          const validationStrings =
            validationErrors[Number(params.row.coreMeasurementID)]?.errors.map(errorDetail => {
              const pairsString = errorDetail.validationPairs
                .map(pair => `(${pair.description} <--> ${pair.criterion})`) // Format each validation pair
                .join(', '); // Combine all pairs for the errorDetail

              return `ID ${errorDetail.id}: ${pairsString}`; // Format the string for the ID
            }) || [];
          return (
            <Tooltip title={`Failing: ${validationStrings.join(',')}`} size="md">
              <ErrorIcon color="error" />
            </Tooltip>
          );
        } else if (params.row.isValidated === null) {
          return (
            <Tooltip title="Pending Validation" size="md">
              <HourglassEmptyIcon color="primary" />
            </Tooltip>
          );
        } else if (params.row.isValidated) {
          return (
            <Tooltip title="Passed Validation" size="md">
              <CheckIcon color="success" />
            </Tooltip>
          );
        } else {
          return null;
        }
      }
    }),
    [rows, validationErrors, paginationModel]
  );

  const measurementDateColumn: GridColDef = {
    field: 'measurementDate',
    headerName: 'Date',
    headerClassName: 'header',
    flex: 0.8,
    sortable: true,
    editable: true,
    type: 'date',
    renderHeader: () => (
      <Box flexDirection={'column'}>
        <Typography level="title-lg">Date</Typography>
        <Typography level="body-xs">YYYY-MM-DD</Typography>
      </Box>
    ),
    valueFormatter: value => {
      if (!value || !moment(value).utc().isValid()) {
        return '';
      }
      return moment(value).utc().format('YYYY-MM-DD');
    }
  };

  const getCellErrorMessages = (colField: string, coreMeasurementID: number) => {
    const error = validationErrors[coreMeasurementID].errors;
    if (!error || !Array.isArray(error)) {
      return '';
    }
    return error.flatMap(errorDetail => errorDetail.validationPairs).find(vp => vp.criterion === colField)?.description || null;
  };

  const columns = useMemo(() => {
    const commonColumns = gridColumns.map(column => {
      if (column.field === 'attributes') {
        column = {
          ...column,
          renderEditCell: (params: GridRenderEditCellParams) => (
            <InputChip params={params} selectableAttributes={selectableAttributes} setReloadAttributes={setReloadAttrs} />
          )
        };
      }
      if (['measuredDBH', 'measuredHOM', 'stemLocalX', 'stemLocalY'].includes(column.field)) {
        column = {
          ...column,
          renderEditCell: (params: GridRenderEditCellParams) => <EditMeasurements params={params} />
        };
      }
      return {
        ...column,
        renderCell: (params: GridCellParams) => {
          const value = typeof params.value === 'string' ? params.value : (params.value?.toString() ?? '');
          const formattedValue = !isNaN(Number(value)) && value.includes('.') && value.split('.')[1].length > 2 ? Number(value).toFixed(2) : value;
          const rowError = rowHasError(params.id);
          const cellError = cellHasError(column.field, params.id) ? getCellErrorMessages(column.field, Number(params.row.coreMeasurementID)) : '';

          const isMeasurementField =
            column.field === 'measuredDBH' || column.field === 'measuredHOM' || column.field.includes('X') || column.field.includes('Y');
          const isAttributeField = column.field === 'attributes';
          const attributeValues = column.field === 'attributes' && typeof params.value === 'string' ? params.value.replace(/\s+/g, '').split(';') : [];

          function renderMeasurementDetails() {
            return (
              <Typography level="body-sm">{isMeasurementField && params.row[column.field] ? Number(params.row[column.field]).toFixed(2) : 'null'}</Typography>
            );
          }

          function renderAttributeDetails() {
            return attributeValues.map((value: string, index: number) => (
              <Chip key={index} size={'sm'}>
                {value}
              </Chip>
            ));
          }

          return (
            <Box
              sx={{
                display: 'flex',
                flex: 1,
                flexDirection: 'column',
                marginY: 1.5,
                width: '100%',
                bgcolor: rowError ? 'warning.main' : undefined
              }}
            >
              {isMeasurementField ? (
                <Box sx={{ display: 'flex', flexDirection: 'row', gap: '0.5em', alignItems: 'center' }}>{renderMeasurementDetails()}</Box>
              ) : isAttributeField ? (
                <Box sx={{ display: 'flex', flexDirection: 'row', gap: '0.5em', alignItems: 'center' }}>{renderAttributeDetails()}</Box>
              ) : (
                <Typography sx={{ whiteSpace: 'normal', lineHeight: 'normal' }}>{formattedValue}</Typography>
              )}
              {cellError !== '' && (
                <Typography
                  color="danger"
                  variant="solid"
                  sx={{
                    color: 'error.main',
                    fontSize: '0.75rem',
                    mt: 1,
                    whiteSpace: 'normal',
                    lineHeight: 'normal'
                  }}
                >
                  {cellError}
                </Typography>
              )}
            </Box>
          );
        }
      };
    });
    if (locked || (session?.user.userStatus !== 'global' && session?.user.userStatus !== 'db admin')) {
      // permissions locking measurements view actions
      return [validationStatusColumn, measurementDateColumn, ...applyFilterToColumns(commonColumns)];
    }
    return [validationStatusColumn, measurementDateColumn, ...applyFilterToColumns(commonColumns), getGridActionsColumn()];
  }, [MeasurementsSummaryViewGridColumns, locked, rows, validationErrors, rowModesModel]);

  const filteredColumns = useMemo(() => {
    if (hidingEmpty) return filterColumns(rows, columns);
    return columns;
  }, [rows, columns, hidingEmpty]);

  const getRowClassName = (params: any) => {
    const rowId = params.id;
    if (rowHasError(rowId)) {
      return 'error-row';
    } else {
      return 'validated';
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const activeElement = document.activeElement as HTMLElement;

      if (activeElement && activeElement.classList.contains('MuiSelect-root')) {
        if (event.key === 'Enter') {
          event.stopPropagation();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleEnterKeyNavigation = async (params: GridCellParams, event: React.KeyboardEvent) => {
    event.defaultPrevented = true;
    const columnIndex = filteredColumns.findIndex(col => col.field === params.field);
    const isLastColumn = columnIndex === filteredColumns.length - 2;
    const currentColumn = filteredColumns[columnIndex];

    if (isSaveHighlighted) {
      openConfirmationDialog('save', params.id);
      setIsSaveHighlighted(false);
    } else if (currentColumn.type === 'singleSelect') {
      const cell = apiRef.current.getCellElement(params.id, params.field);
      if (cell) {
        const select = cell.querySelector('select');
        if (select) {
          select.focus();
        }
      }
    } else if (isLastColumn) {
      setIsSaveHighlighted(true);
      apiRef.current.setCellFocus(params.id, 'actions');
    } else {
      apiRef.current.setCellFocus(params.id, filteredColumns[columnIndex + 1].field);
    }
  };

  function onQuickFilterChange(incomingValues: GridFilterModel) {
    setFilterModel(prevFilterModel => {
      return {
        ...prevFilterModel,
        quickFilterValues: [...(incomingValues.quickFilterValues || [])]
      };
    });
  }

  async function handleCloseModal(closeModal: Dispatch<SetStateAction<boolean>>) {
    closeModal(false);
    try {
      setLoading(true, 'Refreshing Measurements Summary View...');
      const response = await fetch(`/api/refreshviews/measurementssummary/${currentSite?.schemaName ?? ''}`, { method: 'POST' });
      if (!response.ok) throw new Error('Measurements Summary View Refresh failure');
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (e: any) {
      console.error(e);
    } finally {
      setLoading(false);
    }
    await runFetchPaginated();
  }

  async function handleResetValidations() {
    const clearCMVQuery = `DELETE cmv
                           FROM ${currentSite?.schemaName}.cmverrors AS cmv
                                  JOIN ${currentSite?.schemaName}.coremeasurements AS cm
                                       ON cmv.CoreMeasurementID = cm.CoreMeasurementID
                                  JOIN ${currentSite?.schemaName}.census AS c
                                       ON c.CensusID = cm.CensusID
                           WHERE c.CensusID IN (SELECT CensusID
                                                from ${currentSite?.schemaName}.census
                                                WHERE PlotID = ${currentPlot?.plotID}
                                                  AND PlotCensusNumber = ${currentCensus?.plotCensusNumber})
                             AND c.PlotID = ${currentPlot?.plotID}
                             AND (cm.IsValidated = FALSE OR cm.IsValidated IS NULL);`;
    const query = `UPDATE ${currentSite?.schemaName}.coremeasurements AS cm
      JOIN ${currentSite?.schemaName}.census AS c ON c.CensusID = cm.CensusID
                   SET cm.IsValidated = NULL
                   WHERE c.CensusID IN (SELECT CensusID
                                        from ${currentSite?.schemaName}.census
                                        WHERE PlotID = ${currentPlot?.plotID}
                                          AND PlotCensusNumber = ${currentCensus?.plotCensusNumber})
                     AND c.PlotID = ${currentPlot?.plotID}`;
    const clearCMVResponse = await fetch(`/api/runquery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(clearCMVQuery)
    });
    if (!clearCMVResponse.ok) throw new Error('clear cmverrors query failed!');
    const response = await fetch(`/api/runquery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query)
    });
    if (!response.ok) throw new Error('validation override failed');
  }

  if (!currentSite || !currentPlot || !currentCensus) {
    redirect('/dashboard');
  } else {
    return (
      <Box
        sx={{
          width: '100%',
          '& .actions': {
            color: 'text.secondary'
          },
          '& .textPrimary': {
            color: 'text.primary'
          }
        }}
      >
        <Box sx={{ width: '100%', flexDirection: 'column' }}>
          <Stack direction={'row'} justifyContent="space-between">
            <Stack direction="row" spacing={2}>
              <Typography>
                <Checkbox
                  checked={showErrorRows}
                  onChange={event => setShowErrorRows(event.target.checked)}
                  label={`Show rows failing validation: (${errorCount})`}
                />
              </Typography>
              <Typography>
                <Checkbox
                  checked={showValidRows}
                  onChange={event => setShowValidRows(event.target.checked)}
                  label={`Show rows passing validation: (${validCount})`}
                />
              </Typography>
              <Typography>
                <Checkbox
                  checked={showPendingRows}
                  onChange={event => setShowPendingRows(event.target.checked)}
                  label={`Show rows pending validation: (${pendingCount})`}
                />
              </Typography>
              <Typography>
                <Checkbox
                  checked={hidingEmpty}
                  onChange={event => setHidingEmpty(event.target.checked)}
                  label={<strong>{hidingEmpty ? `Hiding Empty Columns` : `Hide Empty Columns`}</strong>}
                />
              </Typography>
            </Stack>
          </Stack>
          <StyledDataGrid
            apiRef={apiRef}
            sx={{ width: '100%' }}
            rows={rows}
            columns={filteredColumns}
            editMode="row"
            rowModesModel={rowModesModel}
            disableColumnSelector
            onRowModesModelChange={handleRowModesModelChange}
            onRowEditStop={handleRowEditStop}
            processRowUpdate={processRowUpdate}
            loading={refresh}
            paginationMode="server"
            onPaginationModelChange={newPaginationModel => {
              setPaginationModel(newPaginationModel);
            }}
            onProcessRowUpdateError={error => {
              console.error('Row update error:', error);
              setSnackbar({
                children: 'Error updating row',
                severity: 'error'
              });
            }}
            onCellKeyDown={(params, event) => {
              if (event.key === 'Enter') {
                handleEnterKeyNavigation(params, event).then(r => {});
              }
            }}
            paginationModel={paginationModel}
            rowCount={rowCount}
            onRowCountChange={handleRowCountChange}
            pageSizeOptions={[10, 25, 50, 100]}
            sortModel={sortModel}
            onSortModelChange={handleSortModelChange}
            filterModel={filterModel}
            onFilterModelChange={newFilterModel => {
              setFilterModel(prevModel => ({
                ...prevModel,
                ...newFilterModel
              }));
            }}
            ignoreDiacritics
            initialState={{
              columns: {
                columnVisibilityModel: getColumnVisibilityModel(gridType)
              }
            }}
            slots={{
              toolbar: EditToolbar
            }}
            slotProps={{
              toolbar: {
                locked: locked,
                handleAddNewRow: handleAddNewRow,
                handleRefresh: () => setRefresh(true),
                handleExport: fetchRowsForExport,
                handleQuickFilterChange: onQuickFilterChange,
                filterModel: filterModel,
                gridColumns: gridColumns,
                dynamicButtons: [
                  ...dynamicButtons,
                  { label: 'Run Validations', tooltip: 'Re-trigger validation queries', onClick: () => setIsValidationModalOpen(true), icon: <CloudSync /> },
                  {
                    label: 'Override Failed Validations?',
                    tooltip: 'Forcibly update all validation results to PASSED',
                    onClick: () => setIsValidationOverrideModalOpen(true),
                    icon: <GppGoodOutlined />
                  },
                  {
                    label: 'Reset Validation Results?',
                    tooltip: 'Delete all validation results and set all rows to PENDING',
                    onClick: () => setIsResetValidationModalOpen(true),
                    icon: <SettingsBackupRestoreRounded />
                  }
                ]
              } as EditToolbarProps
            }}
            getRowHeight={() => 'auto'}
            getRowClassName={getRowClassName}
            isCellEditable={() => !locked}
          />
        </Box>
        {!!snackbar && (
          <Snackbar open anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} onClose={handleCloseSnackbar} autoHideDuration={6000}>
            <Alert {...snackbar} onClose={handleCloseSnackbar} />
          </Snackbar>
        )}
        {isDialogOpen && promiseArguments && !promiseArguments.oldRow.isNew && (
          <MSVEditingModal
            gridType={gridType}
            oldRow={promiseArguments.oldRow}
            newRow={promiseArguments.newRow}
            handleClose={handleCancelAction}
            handleSave={handleConfirmAction}
          />
        )}
        {isDeleteDialogOpen && (
          <ConfirmationDialog
            open={isDeleteDialogOpen}
            onClose={handleCancelAction}
            onConfirm={handleConfirmAction}
            title="Confirm Deletion"
            content="Are you sure you want to delete this row? This action cannot be undone."
          />
        )}
        {isValidationModalOpen && (
          <Modal open={isValidationModalOpen} onClose={async () => await handleCloseModal(setIsValidationModalOpen)}>
            <ModalDialog
              sx={{
                width: '80%',
                borderRadius: 'md',
                p: 2,
                boxShadow: 'lg',
                display: 'flex',
                flex: 1,
                flexDirection: 'column',
                alignItems: 'center'
              }}
            >
              <ValidationCore onValidationComplete={() => handleCloseModal(setIsValidationModalOpen)} />
            </ModalDialog>
          </Modal>
        )}
        {isValidationOverrideModalOpen && (
          <ValidationOverrideModal
            isValidationOverrideModalOpen={isValidationOverrideModalOpen}
            handleValidationOverrideModalClose={async () => await handleCloseModal(setIsValidationOverrideModalOpen)}
          />
        )}
        {isResetValidationModalOpen && (
          <Modal open={isResetValidationModalOpen} onClose={async () => await handleCloseModal(setIsResetValidationModalOpen)}>
            <ModalDialog role={'alertdialog'}>
              <DialogTitle>Reset Validation States?</DialogTitle>
              <DialogContent>Are you sure you want to reset all validation states? </DialogContent>
              <DialogActions>
                <Button
                  onClick={async () => {
                    await handleResetValidations();
                    await handleCloseModal(setIsResetValidationModalOpen);
                  }}
                >
                  Yes
                </Button>
                <Button onClick={async () => await handleCloseModal(setIsResetValidationModalOpen)}>No</Button>
              </DialogActions>
            </ModalDialog>
          </Modal>
        )}
      </Box>
    );
  }
}
