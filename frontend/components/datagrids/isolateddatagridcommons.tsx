'use client';

import {
  CellItemContainer,
  createDeleteQuery,
  createFetchQuery,
  createPostPatchQuery,
  createQFFetchQuery,
  EditToolbarCustomProps,
  filterColumns,
  getColumnVisibilityModel,
  getGridID,
  IsolatedDataGridCommonProps,
  PendingAction
} from '@/config/datagridhelpers';
import {
  GridActionsCellItem,
  GridColDef,
  GridEventListener,
  GridFilterModel,
  GridRowEditStopReasons,
  GridRowId,
  GridRowModel,
  GridRowModes,
  GridRowModesModel,
  GridRowsProp,
  GridToolbarContainer,
  GridToolbarProps,
  GridToolbarQuickFilter,
  GridToolbarColumnsButton,
  GridToolbarFilterButton,
  ToolbarPropsOverrides,
  useGridApiRef
} from '@mui/x-data-grid';
import { Alert, AlertProps, Button, IconButton, Snackbar } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useOrgCensusContext, usePlotContext, useQuadratContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import { useDataValidityContext } from '@/app/contexts/datavalidityprovider';
import { useSession } from 'next-auth/react';
import { HTTPResponses, UnifiedValidityFlags } from '@/config/macros';
import { Dropdown, Menu, MenuButton, MenuItem, Stack, Tooltip } from '@mui/joy';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Close';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import { redirect } from 'next/navigation';
import Box from '@mui/joy/Box';
import { StyledDataGrid } from '@/config/styleddatagrid';
import ConfirmationDialog from '@/components/datagrids/confirmationdialog';
import { randomId } from '@mui/x-data-grid-generator';
import SkipReEnterDataModal from '@/components/datagrids/skipreentrydatamodal';
import { FormType, getTableHeaders } from '@/config/macros/formdetails';
import { applyFilterToColumns } from '@/components/datagrids/filtrationsystem';
import { ClearIcon } from '@mui/x-date-pickers';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';

type EditToolbarProps = EditToolbarCustomProps & GridToolbarProps & ToolbarPropsOverrides;

const EditToolbar = (props: EditToolbarProps) => {
  const { handleAddNewRow, handleRefresh, handleExportAll, handleExportCSV, handleQuickFilterChange, locked, filterModel, dynamicButtons = [] } = props;
  if (!handleAddNewRow || !handleRefresh || !handleQuickFilterChange || !handleExportAll) return <></>;
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);

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

  return (
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
                sx={{ ml: 2 }}
              />
              <Tooltip title={'Clear filter'} placement={'right'}>
                <IconButton
                  aria-label={'clear filter'}
                  disabled={inputValue === ''}
                  onClick={handleClearInput}
                  size={'small'}
                  edge={'end'}
                  sx={{ marginLeft: 1 }}
                >
                  <ClearIcon fontSize={'small'} />
                </IconButton>
              </Tooltip>
            </Box>
          </Tooltip>
          {/*<Button variant={'text'} color={'primary'} startIcon={<AddIcon />} onClick={async () => await handleAddNewRow()} disabled={locked}>*/}
          {/*  Add Row*/}
          {/*</Button>*/}
          <Button variant={'text'} color={'primary'} startIcon={<RefreshIcon />} onClick={async () => await handleRefresh()}>
            Refresh
          </Button>
          <Dropdown>
            <MenuButton
              variant={'plain'}
              color={'primary'}
              endDecorator={
                <CloudDownloadIcon
                  sx={{
                    fontSize: '1.5rem',
                    verticalAlign: 'middle'
                  }}
                />
              }
            >
              Export...
            </MenuButton>
            <Menu variant={'soft'} color={'primary'} placement={'bottom-start'}>
              <MenuItem variant={'soft'} color={'primary'} onClick={async () => await handleExportAll()}>
                All data as JSON
              </MenuItem>
              <MenuItem variant={'soft'} color={'primary'} onClick={handleExportCSV}>
                All Data as CSV
              </MenuItem>
              <MenuItem variant={'soft'} color={'primary'} onClick={exportFilterModel}>
                Filter Settings
              </MenuItem>
            </Menu>
          </Dropdown>
        </Box>
      </Box>
      <Stack direction={'row'} spacing={2}>
        {dynamicButtons.map((button: any, index: number) => (
          <>
            {button.tooltip ? (
              <>
                <Tooltip title={button.tooltip} placement={'bottom'} arrow>
                  <Button key={index} onClick={button.onClick} variant={'contained'} color={'primary'}>
                    {button.label}
                  </Button>
                </Tooltip>
              </>
            ) : (
              <Button key={index} onClick={button.onClick} variant={'contained'} color={'primary'}>
                {button.label}
              </Button>
            )}
          </>
        ))}
      </Stack>
    </GridToolbarContainer>
  );
};

export default function IsolatedDataGridCommons(props: Readonly<IsolatedDataGridCommonProps>) {
  const { gridColumns, gridType, refresh, setRefresh, locked = false, selectionOptions, initialRow, fieldToFocus, clusters, dynamicButtons = [] } = props;

  const [rows, setRows] = useState([initialRow] as GridRowsProp);
  const [rowCount, setRowCount] = useState(0);
  const [rowModesModel, setRowModesModel] = useState<GridRowModesModel>({});
  const [snackbar, setSnackbar] = React.useState<Pick<AlertProps, 'children' | 'severity'> | null>(null);
  const [paginationModel, setPaginationModel] = useState({
    page: 0,
    pageSize: 10
  });
  const [loading, setLoading] = useState(false);
  const [isNewRowAdded, setIsNewRowAdded] = useState(false);
  const [shouldAddRowAfterFetch, setShouldAddRowAfterFetch] = useState(false);
  const [newLastPage, setNewLastPage] = useState<number | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [usingQuery, setUsingQuery] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction>({
    actionType: '',
    actionId: null
  });
  const [promiseArguments, setPromiseArguments] = useState<{
    resolve: (value: GridRowModel) => void;
    reject: (reason?: any) => void;
    newRow: GridRowModel;
    oldRow: GridRowModel;
  } | null>(null);
  const [filterModel, setFilterModel] = useState<GridFilterModel>({
    items: [],
    quickFilterValues: []
  });

  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const currentQuadrat = useQuadratContext();
  const currentSite = useSiteContext();

  const { triggerRefresh } = useDataValidityContext();

  useSession();

  const apiRef = useGridApiRef();

  useEffect(() => {
    if (currentPlot?.plotID || currentCensus?.plotCensusNumber || !isNewRowAdded) {
      fetchPaginatedData(paginationModel.page).catch(console.error);
    }
  }, [currentPlot, currentCensus, paginationModel.page, filterModel]);

  useEffect(() => {
    if (refresh && currentSite) {
      handleRefresh().then(() => {
        if (refresh) {
          setRefresh(false);
        }
      });
    }
  }, [refresh, currentSite]);

  useEffect(() => {
    const updatedRowModesModel = rows.reduce((acc, row) => {
      if (row.id) {
        acc[row.id] = rowModesModel[row.id] || { mode: GridRowModes.View };
      }
      return acc;
    }, {} as GridRowModesModel);

    const cleanedRowModesModel = Object.fromEntries(Object.entries(updatedRowModesModel).filter(([key]) => key !== '0'));

    if (JSON.stringify(cleanedRowModesModel) !== JSON.stringify(rowModesModel)) {
      setRowModesModel(cleanedRowModesModel);
    }
  }, [rows]);

  const fetchFullData = useCallback(async () => {
    setLoading(true);
    try {
      const tempQuery = createQFFetchQuery(
        currentSite?.schemaName ?? '',
        gridType,
        paginationModel.page,
        paginationModel.pageSize,
        currentPlot?.plotID,
        currentCensus?.plotCensusNumber
      );

      const results = await (
        await fetch(`/api/runquery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            (
              await (
                await fetch(tempQuery, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ filterModel })
                })
              ).json()
            ).finishedQuery
              .replace(/\bSQL_CALC_FOUND_ROWS\b\s*/i, '')
              .replace(/\bLIMIT\s+\d+\s*,\s*\d+/i, '')
              .trim()
          )
        })
      ).json();

      const jsonData = JSON.stringify(results, null, 2);
      const blob = new Blob([jsonData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      link.download = 'results.json';
      link.click();

      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error fetching full data:', error);
      setSnackbar({ children: 'Error fetching full data', severity: 'error' });
    } finally {
      setLoading(false);
    }
  }, [usingQuery, filterModel, currentPlot, currentCensus, currentQuadrat, currentSite, gridType, setLoading]);

  const exportAllCSV = useCallback(async () => {
    setLoading(true);
    switch (gridType) {
      case 'attributes':
        const aResponse = await fetch(
          `/api/formdownload/attributes/${currentSite?.schemaName ?? ''}/${currentPlot?.plotID ?? 0}/${currentCensus?.dateRanges[0].censusID ?? 0}/${JSON.stringify(filterModel)}`,
          { method: 'GET' }
        );
        const aData = await aResponse.json();
        let aCSVRows =
          getTableHeaders(FormType.attributes)
            .map(row => row.label)
            .join(',') + '\n';
        aData.forEach((row: any) => {
          const values = getTableHeaders(FormType.attributes)
            .map(rowHeader => rowHeader.label)
            .map(header => row[header])
            .map(value => {
              if (value === undefined || value === null || value === '') {
                return null;
              }
              if (typeof value === 'number') {
                return value;
              }
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
          aCSVRows += values.join(',') + '\n';
        });
        const aBlob = new Blob([aCSVRows], {
          type: 'text/csv;charset=utf-8;'
        });
        const aURL = URL.createObjectURL(aBlob);
        const aLink = document.createElement('a');
        aLink.href = aURL;
        aLink.download = `attributesform_${currentSite?.schemaName ?? ''}_${currentPlot?.plotName ?? ''}_${currentCensus?.plotCensusNumber ?? 0}.csv`;
        document.body.appendChild(aLink);
        aLink.click();
        document.body.removeChild(aLink);
        break;
      case 'quadrats':
        const qResponse = await fetch(
          `/api/formdownload/quadrats/${currentSite?.schemaName ?? ''}/${currentPlot?.plotID ?? 0}/${currentCensus?.dateRanges[0].censusID ?? 0}`,
          { method: 'GET' }
        );
        const qData = await qResponse.json();
        let qCSVRows =
          getTableHeaders(FormType.quadrats)
            .map(row => row.label)
            .join(',') + '\n';
        qData.forEach((row: any) => {
          const values = getTableHeaders(FormType.quadrats)
            .map(rowHeader => rowHeader.label)
            .map(header => row[header])
            .map(value => {
              if (value === undefined || value === null || value === '') {
                return null;
              }
              if (typeof value === 'number') {
                return value;
              }
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
          qCSVRows += values.join(',') + '\n';
        });
        const qBlob = new Blob([qCSVRows], {
          type: 'text/csv;charset=utf-8;'
        });
        const qURL = URL.createObjectURL(qBlob);
        const qLink = document.createElement('a');
        qLink.href = qURL;
        qLink.download = `quadratsform_${currentSite?.schemaName ?? ''}_${currentPlot?.plotName ?? ''}_${currentCensus?.plotCensusNumber ?? 0}.csv`;
        document.body.appendChild(qLink);
        qLink.click();
        document.body.removeChild(qLink);
        break;
      case 'personnel':
        const pResponse = await fetch(
          `/api/formdownload/personnel/${currentSite?.schemaName ?? ''}/${currentPlot?.plotID ?? 0}/${currentCensus?.dateRanges[0].censusID ?? 0}`,
          { method: 'GET' }
        );
        const pData = await pResponse.json();
        let pCSVRows =
          getTableHeaders(FormType.personnel)
            .map(row => row.label)
            .join(',') + '\n';
        pData.forEach((row: any) => {
          const values = getTableHeaders(FormType.personnel)
            .map(rowHeader => rowHeader.label)
            .map(header => row[header])
            .map(value => {
              if (value === undefined || value === null || value === '') {
                return null;
              }
              if (typeof value === 'number') {
                return value;
              }
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
          pCSVRows += values.join(',') + '\n';
        });
        const pBlob = new Blob([pCSVRows], {
          type: 'text/csv;charset=utf-8;'
        });
        const pURL = URL.createObjectURL(pBlob);
        const pLink = document.createElement('a');
        pLink.href = pURL;
        pLink.download = `personnelform_${currentSite?.schemaName ?? ''}_${currentPlot?.plotName ?? ''}_${currentCensus?.plotCensusNumber ?? 0}.csv`;
        document.body.appendChild(pLink);
        pLink.click();
        document.body.removeChild(pLink);
        break;
      case 'species':
      case 'alltaxonomiesview':
        const sResponse = await fetch(
          `/api/formdownload/species/${currentSite?.schemaName ?? ''}/${currentPlot?.plotID ?? 0}/${currentCensus?.dateRanges[0].censusID ?? 0}`,
          { method: 'GET' }
        );
        const sData = await sResponse.json();
        let sCSVRows =
          getTableHeaders(FormType.species)
            .map(row => row.label)
            .join(',') + '\n';
        sData.forEach((row: any) => {
          const values = getTableHeaders(FormType.species)
            .map(rowHeader => rowHeader.label)
            .map(header => row[header])
            .map(value => {
              if (value === undefined || value === null || value === '') {
                return null;
              }
              if (typeof value === 'number') {
                return value;
              }
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
          sCSVRows += values.join(',') + '\n';
        });
        const sBlob = new Blob([sCSVRows], {
          type: 'text/csv;charset=utf-8;'
        });
        const sURL = URL.createObjectURL(sBlob);
        const sLink = document.createElement('a');
        sLink.href = sURL;
        sLink.download = `speciesform_${currentSite?.schemaName ?? ''}_${currentPlot?.plotName ?? ''}_${currentCensus?.plotCensusNumber ?? 0}.csv`;
        document.body.appendChild(sLink);
        sLink.click();
        document.body.removeChild(sLink);
        break;
    }
    setLoading(false);
  }, [currentPlot, currentCensus, currentSite, gridType]);

  const openConfirmationDialog = useCallback(
    (actionType: 'save' | 'delete', actionId: GridRowId) => {
      setPendingAction({ actionType, actionId });

      const row = rows.find(row => String(row.id) === String(actionId));
      if (row) {
        if (actionType === 'delete') {
          setIsDeleteDialogOpen(true);
        } else {
          setIsDialogOpen(true);
        }
      }
    },
    [rows]
  );

  const handleConfirmAction = useCallback(
    async (confirmedRow?: GridRowModel) => {
      setIsDialogOpen(false);
      setIsDeleteDialogOpen(false);

      if (pendingAction.actionType === 'delete' && pendingAction.actionId !== null) {
        await performDeleteAction(pendingAction.actionId);
      } else if (promiseArguments) {
        try {
          const resolvedRow = confirmedRow || promiseArguments.newRow;
          await performSaveAction(promiseArguments.newRow.id, resolvedRow);
          setSnackbar({ children: 'Row successfully updated!', severity: 'success' });
        } catch (error: any) {
          setSnackbar({ children: `Error: ${error.message}`, severity: 'error' });
        }
      }

      setPendingAction({ actionType: '', actionId: null });
      setPromiseArguments(null);
    },
    [pendingAction, promiseArguments]
  );

  const handleCancelAction = useCallback(() => {
    setIsDialogOpen(false);
    setIsDeleteDialogOpen(false);
    if (promiseArguments) {
      promiseArguments.reject(new Error('Action cancelled by user'));
    }
    setPendingAction({ actionType: '', actionId: null });
    setPromiseArguments(null);
  }, [promiseArguments]);

  const performSaveAction = useCallback(
    async (id: GridRowId, confirmedRow: GridRowModel) => {
      if (locked || !promiseArguments) return;

      setLoading(true);
      try {
        setRowModesModel(prevModel => ({
          ...prevModel,
          [id]: { mode: GridRowModes.View }
        }));

        const updatedRow = await updateRow(
          gridType,
          currentSite?.schemaName,
          confirmedRow,
          promiseArguments.oldRow,
          setSnackbar,
          setIsNewRowAdded,
          setShouldAddRowAfterFetch,
          fetchPaginatedData,
          paginationModel
        );

        promiseArguments.resolve(updatedRow);

        if (props.onDataUpdate) {
          props.onDataUpdate();
        }
      } catch (error) {
        promiseArguments.reject(error);
      } finally {
        setLoading(false);
      }

      triggerRefresh();
      setLoading(false);
      await fetchPaginatedData(paginationModel.page);
    },
    [
      locked,
      promiseArguments,
      gridType,
      currentSite,
      setSnackbar,
      setIsNewRowAdded,
      setShouldAddRowAfterFetch,
      paginationModel,
      rows,
      triggerRefresh,
      setLoading
    ]
  );

  const performDeleteAction = useCallback(
    async (id: GridRowId) => {
      if (locked) return;

      setLoading(true);

      const rowToDelete = rows.find(row => String(row.id) === String(id));
      if (!rowToDelete) return;

      const deleteQuery = createDeleteQuery(currentSite?.schemaName ?? '', gridType, getGridID(gridType), rowToDelete.id);

      try {
        const response = await fetch(deleteQuery, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ newRow: rowToDelete })
        });

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
          setRows(prevRows => prevRows.filter(row => row.id !== id));
          setSnackbar({
            children: 'Row successfully deleted',
            severity: 'success'
          });
          triggerRefresh([gridType as keyof UnifiedValidityFlags]);
          await fetchPaginatedData(paginationModel.page);
        }
      } catch (error: any) {
        setSnackbar({
          children: `Error: ${error.message || 'Deletion failed'}`,
          severity: 'error'
        });
      } finally {
        setLoading(false);
      }
    },
    [locked, rows, currentSite, gridType, setSnackbar, paginationModel, triggerRefresh, setLoading]
  );

  const handleSaveClick = useCallback(
    (id: GridRowId) => () => {
      if (locked) return;

      const updatedRowModesModel = { ...rowModesModel };
      if (!updatedRowModesModel[id] || updatedRowModesModel[id].mode === undefined) {
        updatedRowModesModel[id] = { mode: GridRowModes.View };
      }

      apiRef.current.stopRowEditMode({ id, ignoreModifications: true });

      const oldRow = rows.find(row => String(row.id) === String(id));

      const updatedRow = apiRef.current.getRowWithUpdatedValues(id, 'anyField');

      if (oldRow && updatedRow) {
        setPromiseArguments({
          resolve: (value: GridRowModel) => {},
          reject: (reason?: any) => {},
          oldRow,
          newRow: updatedRow
        });

        openConfirmationDialog('save', id);
      }
    },
    [locked, rowModesModel, rows, apiRef, openConfirmationDialog]
  );

  const handleDeleteClick = useCallback(
    (id: GridRowId) => () => {
      if (locked) return;
      if (gridType === 'census') {
        const rowToDelete = rows.find(row => String(row.id) === String(id));
        if (currentCensus && rowToDelete && rowToDelete.censusID === currentCensus.dateRanges[0].censusID) {
          alert('Cannot delete the currently selected census.');
          return;
        }
      }
      openConfirmationDialog('delete', id);
    },
    [locked, gridType, currentCensus, rows, openConfirmationDialog]
  );

  const handleAddNewRow = useCallback(() => {
    if (locked) return;
    if (isNewRowAdded) return;
    const newRowCount = rowCount + 1;
    const calculatedNewLastPage = Math.ceil(newRowCount / paginationModel.pageSize) - 1;
    const existingLastPage = Math.ceil(rowCount / paginationModel.pageSize) - 1;
    const isNewPageNeeded = newRowCount % paginationModel.pageSize === 1;
    if (isNewPageNeeded) {
      setPaginationModel({ ...paginationModel, page: calculatedNewLastPage });
    } else {
      setPaginationModel({ ...paginationModel, page: existingLastPage });
    }
    const id = randomId();
    const newRow = { ...initialRow, id, isNew: true };
    setRows(prevRows => {
      return [...prevRows, newRow];
    });
    setRowModesModel(prevModel => {
      return {
        ...prevModel,
        [id]: { mode: GridRowModes.Edit, fieldToFocus }
      };
    });

    setShouldAddRowAfterFetch(isNewPageNeeded);
    setNewLastPage(calculatedNewLastPage);
    setIsNewRowAdded(true);
  }, [locked, isNewRowAdded, rowCount, paginationModel, initialRow, setRows, setRowModesModel, fieldToFocus]);

  const handleRefresh = useCallback(async () => {
    await fetchPaginatedData(paginationModel.page);
  }, [paginationModel.page]);

  const fetchPaginatedData = async (pageToFetch: number) => {
    setLoading(true);
    const paginatedQuery =
      (filterModel.items && filterModel.items.length > 0) || (filterModel.quickFilterValues && filterModel.quickFilterValues.length > 0)
        ? createQFFetchQuery(
            currentSite?.schemaName ?? '',
            gridType,
            pageToFetch,
            paginationModel.pageSize,
            currentPlot?.plotID,
            currentCensus?.plotCensusNumber,
            currentQuadrat?.quadratID
          )
        : createFetchQuery(
            currentSite?.schemaName ?? '',
            gridType,
            pageToFetch,
            paginationModel.pageSize,
            currentPlot?.plotID,
            currentCensus?.plotCensusNumber,
            currentQuadrat?.quadratID
          );
    try {
      const response = await fetch(paginatedQuery, {
        method:
          (filterModel.items && filterModel.items.length > 0) || (filterModel.quickFilterValues && filterModel.quickFilterValues.length > 0) ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json' },
        body:
          (filterModel.items && filterModel.items.length > 0) || (filterModel.quickFilterValues && filterModel.quickFilterValues.length > 0)
            ? JSON.stringify({ filterModel })
            : undefined
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Error fetching data');
      setRows(data.output);
      setRowCount(data.totalCount);
      setUsingQuery(data.finishedQuery);

      if (isNewRowAdded && pageToFetch === newLastPage) {
        handleAddNewRow();
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      setSnackbar({ children: 'Error fetching data', severity: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const updateRow = async (
    gridType: string,
    schemaName: string | undefined,
    newRow: GridRowModel,
    oldRow: GridRowModel,
    setSnackbar: (value: { children: string; severity: 'error' | 'success' }) => void,
    setIsNewRowAdded: (value: boolean) => void,
    setShouldAddRowAfterFetch: (value: boolean) => void,
    fetchPaginatedData: (page: number) => Promise<void>,
    paginationModel: { page: number }
  ): Promise<GridRowModel> => {
    const gridID = getGridID(gridType);
    const fetchProcessQuery =
      gridType !== 'quadrats'
        ? createPostPatchQuery(schemaName ?? '', gridType, gridID)
        : createPostPatchQuery(schemaName ?? '', gridType, gridID, currentPlot?.plotID, currentCensus?.dateRanges[0].censusID);

    try {
      setLoading(true);
      const response = await fetch(fetchProcessQuery, {
        method: oldRow.isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldRow: oldRow, newRow: newRow })
      });

      const responseJSON = await response.json();

      if (!response.ok) {
        throw new Error(responseJSON.message || 'An unknown error occurred');
      }

      setSnackbar({
        children: oldRow.isNew ? 'New row added!' : 'Row updated!',
        severity: 'success'
      });

      if (oldRow.isNew) {
        setIsNewRowAdded(false);
        setShouldAddRowAfterFetch(false);
        await fetchPaginatedData(paginationModel.page);
      }

      return newRow;
    } catch (error: any) {
      setSnackbar({ children: `Error: ${error.message}`, severity: 'error' });
      return Promise.reject(newRow);
    } finally {
      setLoading(false);
    }
  };

  const processRowUpdate = useCallback(
    async (newRow: GridRowModel, oldRow: GridRowModel) => {
      if (newRow?.isNew && !newRow?.id) {
        return oldRow;
      }

      setLoading(true);

      if (newRow.isNew || !newRow.id) {
        setPromiseArguments({
          resolve: async (confirmedRow: GridRowModel) => {
            try {
              const updatedRow = await updateRow(
                gridType,
                currentSite?.schemaName,
                confirmedRow,
                oldRow,
                setSnackbar,
                setIsNewRowAdded,
                setShouldAddRowAfterFetch,
                fetchPaginatedData,
                paginationModel
              );
              setLoading(false);
              return updatedRow;
            } catch (error: any) {
              setLoading(false);
              setSnackbar({ children: `Error: ${error.message}`, severity: 'error' });
              return Promise.reject(error);
            }
          },
          reject: reason => {
            setLoading(false);
            return Promise.reject(reason);
          },
          oldRow,
          newRow
        });

        openConfirmationDialog('save', newRow.id);
        return Promise.reject(new Error('Row update interrupted for new row, awaiting confirmation'));
      }

      try {
        const updatedRow = await updateRow(
          gridType,
          currentSite?.schemaName,
          newRow,
          oldRow,
          setSnackbar,
          setIsNewRowAdded,
          setShouldAddRowAfterFetch,
          fetchPaginatedData,
          paginationModel
        );
        setLoading(false);
        return updatedRow;
      } catch (error: any) {
        setLoading(false);
        setSnackbar({ children: `Error: ${error.message}`, severity: 'error' });
        return Promise.reject(error);
      }
    },
    [gridType, currentSite?.schemaName, setSnackbar, setIsNewRowAdded, setShouldAddRowAfterFetch, fetchPaginatedData, paginationModel]
  );

  const handleRowModesModelChange = useCallback((newRowModesModel: GridRowModesModel) => {
    setRowModesModel(prevModel => {
      const updatedModel = { ...prevModel };
      Object.keys(newRowModesModel).forEach(id => {
        if (updatedModel[id]) {
          updatedModel[id] = {
            ...updatedModel[id],
            ...newRowModesModel[id],
            mode: newRowModesModel[id]?.mode || updatedModel[id]?.mode || GridRowModes.View
          };
        } else {
          console.warn(`Row ID ${id} does not exist in rowModesModel. Skipping.`);
        }
      });
      return updatedModel;
    });
  }, []);

  const handleCloseSnackbar = useCallback(() => setSnackbar(null), []);

  const handleRowEditStop = useCallback<GridEventListener<'rowEditStop'>>((params, event) => {
    if (params.reason === GridRowEditStopReasons.rowFocusOut) {
      event.defaultMuiPrevented = true;
    }
  }, []);

  const handleEditClick = useCallback(
    (id: GridRowId) => () => {
      if (locked) return;
      setRowModesModel(prevModel => ({
        ...prevModel,
        [id]: { mode: GridRowModes.Edit }
      }));
      setTimeout(() => {
        const firstEditableColumn = filteredColumns.find(col => col.editable);
        if (firstEditableColumn) {
          apiRef.current.setCellFocus(id, firstEditableColumn.field);
        }
      });
    },
    [locked, apiRef]
  );

  const handleCancelClick = useCallback(
    (id: GridRowId, event?: React.MouseEvent | React.KeyboardEvent) => {
      if (locked) return;
      event?.preventDefault();

      const row = rows.find(row => String(row.id) === String(id));

      if (row?.isNew) {
        setRows(oldRows => oldRows.filter(row => row.id !== id));

        setRowModesModel(prevModel => {
          const updatedModel = { ...prevModel };
          delete updatedModel[id];
          return updatedModel;
        });

        setIsNewRowAdded(false);
      } else {
        setRowModesModel(prevModel => ({
          ...prevModel,
          [id]: { mode: GridRowModes.View, ignoreModifications: true }
        }));
      }
    },
    [locked, rows]
  );

  function onQuickFilterChange(incomingValues: GridFilterModel) {
    setFilterModel(prevFilterModel => {
      return {
        ...prevFilterModel,
        items: [...(incomingValues.items || [])],
        quickFilterValues: [...(incomingValues.quickFilterValues || [])]
      };
    });
  }

  const getEnhancedCellAction = useCallback(
    (type: string, icon: any, onClick: any) => (
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
                    : type === 'Limits'
                      ? 'View limits for this row'
                      : undefined
          }
          arrow
          placement="top"
        >
          <GridActionsCellItem icon={icon} label={type} onClick={onClick} />
        </Tooltip>
      </CellItemContainer>
    ),
    []
  );

  const getGridActionsColumn = useCallback(
    (): GridColDef => ({
      field: 'actions',
      type: 'actions',
      headerName: 'Actions',
      flex: 1,
      cellClassName: 'actions',
      getActions: ({ id }) => {
        if (!rowModesModel[id]?.mode) return [];
        const isInEditMode = rowModesModel[id]?.mode === GridRowModes.Edit;
        if (isInEditMode && !locked) {
          return [
            getEnhancedCellAction('Save', <SaveIcon />, handleSaveClick(id)),
            getEnhancedCellAction('Cancel', <CancelIcon />, (e: any) => handleCancelClick(id, e))
          ];
        }
        return [getEnhancedCellAction('Edit', <EditIcon />, handleEditClick(id)), getEnhancedCellAction('Delete', <DeleteIcon />, handleDeleteClick(id))];
      }
    }),
    [rowModesModel, locked]
  );

  const columns = useMemo(() => {
    return [...applyFilterToColumns(gridColumns), ...(locked ? [] : [getGridActionsColumn()])];
  }, [gridColumns, rowModesModel, getGridActionsColumn]);

  const filteredColumns = useMemo(() => (gridType !== 'quadratpersonnel' ? filterColumns(rows, columns) : columns), [rows, columns]);

  const handleCellDoubleClick: GridEventListener<'cellDoubleClick'> = params => {
    if (locked) return;
    setRowModesModel(prevModel => ({
      ...prevModel,
      [params.id]: { mode: GridRowModes.Edit }
    }));
  };

  const handleCellKeyDown: GridEventListener<'cellKeyDown'> = (_params, event) => {
    if (event.key === 'Enter' && !locked) {
      event.defaultMuiPrevented = true;
    }
    if (event.key === 'Escape') {
      event.defaultMuiPrevented = true;
    }
  };

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
          <StyledDataGrid
            apiRef={apiRef}
            sx={{ width: '100%' }}
            rows={rows}
            columns={columns}
            editMode="row"
            rowModesModel={rowModesModel}
            disableColumnSelector
            onRowModesModelChange={handleRowModesModelChange}
            onRowEditStop={handleRowEditStop}
            onCellDoubleClick={handleCellDoubleClick}
            onCellKeyDown={handleCellKeyDown}
            processRowUpdate={async (newRow, oldRow) => {
              const waitForStateUpdates = async () => {
                return new Promise<void>(resolve => {
                  const checkUpdates = () => {
                    if (rows.length > 0 && Object.keys(rowModesModel).length > 0) {
                      resolve();
                    } else {
                      setTimeout(checkUpdates, 50);
                    }
                  };
                  checkUpdates();
                });
              };
              await waitForStateUpdates();
              try {
                return await processRowUpdate(newRow, oldRow);
              } catch (error) {
                console.error('Error processing row update:', error);
                setSnackbar({ children: 'Error updating row', severity: 'error' });
                return Promise.reject(error);
              }
            }}
            onProcessRowUpdateError={error => {
              console.error('Row update error:', error);
              setSnackbar({
                children: 'Error updating row',
                severity: 'error'
              });
            }}
            loading={refresh || loading}
            paginationMode="server"
            onPaginationModelChange={setPaginationModel}
            paginationModel={paginationModel}
            rowCount={rowCount}
            pageSizeOptions={[paginationModel.pageSize]}
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
                handleRefresh: handleRefresh,
                handleExportAll: fetchFullData,
                handleExportCSV: exportAllCSV,
                handleQuickFilterChange: onQuickFilterChange,
                filterModel: filterModel,
                dynamicButtons: dynamicButtons
              }
            }}
            getRowHeight={() => 'auto'}
          />
        </Box>
        {!!snackbar && (
          <Snackbar open anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} onClose={handleCloseSnackbar} autoHideDuration={6000}>
            <Alert {...snackbar} onClose={handleCloseSnackbar} />
          </Snackbar>
        )}
        {isDialogOpen && promiseArguments && (
          <SkipReEnterDataModal gridType={gridType} row={promiseArguments.newRow} handleClose={handleCancelAction} handleSave={handleConfirmAction} />
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
      </Box>
    );
  }
}
