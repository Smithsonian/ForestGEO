import { useCallback, useState } from 'react';
import { GridRowId, GridRowModel } from '@mui/x-data-grid';
import { createFetchQuery } from '@/config/datagridhelpers';
import { Site } from '@/config/sqlrdsdefinitions/tables/sitesrds';
import { Plot } from '@/config/sqlrdsdefinitions/tables/plotrds';
import { OrgCensus } from '@/config/sqlrdsdefinitions/orgcensusrds';
import { Quadrat } from '@/config/sqlrdsdefinitions/tables/quadratrds';

import { DataGridCommonProps, PendingAction } from './datagridmacros';

export interface DataGridCommonHookProps {
  currentSite: Site;
  currentPlot: Plot;
  currentCensus: OrgCensus;
  currentQuadrat: Quadrat;
}

export const useDataGridCommons = (
  props: DataGridCommonProps & {
    setLoading: (loading: boolean, message?: string) => void;
  } & DataGridCommonHookProps
) => {
  const {
    gridType,
    currentQuadrat,
    rowCount,
    currentSite,
    currentPlot,
    currentCensus,
    setSnackbar,
    setIsNewRowAdded,
    paginationModel,
    setPaginationModel,
    setLoading,
    setRows,
    setRowCount,
    isNewRowAdded,
    setShouldAddRowAfterFetch,
    addNewRowToGrid
  } = props;

  const [newLastPage, setNewLastPage] = useState<number | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [locked, setLocked] = useState(false);
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

  const openConfirmationDialog = (actionType: 'save' | 'delete', actionId: GridRowId) => {
    setPendingAction({ actionType, actionId });
    setIsDialogOpen(true);
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
    if (locked) return;

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

  const fetchPaginatedData = async (pageToFetch: number) => {
    setLoading(true, 'Loading data...');
    const paginatedQuery = createFetchQuery(
      currentSite?.schemaName ?? '',
      gridType,
      pageToFetch,
      paginationModel.pageSize,
      currentPlot?.plotID,
      currentCensus?.plotCensusNumber,
      currentQuadrat?.quadratID
    );
    try {
      const response = await fetch(paginatedQuery, { method: 'GET' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Error fetching data');
      setRows(data.output);
      setRowCount(data.totalCount);

      if (isNewRowAdded && pageToFetch === newLastPage) {
        addNewRowToGrid();
        setIsNewRowAdded(false);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      setSnackbar({ children: 'Error fetching data', severity: 'error' });
    } finally {
      setLoading(false);
    }
  };

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
    [gridType, currentSite?.schemaName, setSnackbar, setIsNewRowAdded, setShouldAddRowAfterFetch, fetchPaginatedData, paginationModel]
  );

  return {
    handleSaveClick,
    handleDeleteClick,
    handleAddNewRow,
    fetchPaginatedData,
    processRowUpdate,
    isDialogOpen,
    setIsDialogOpen,
    isDeleteDialogOpen,
    setIsDeleteDialogOpen,
    locked,
    setLocked,
    pendingAction,
    setPendingAction,
    promiseArguments,
    setPromiseArguments
  };
};
