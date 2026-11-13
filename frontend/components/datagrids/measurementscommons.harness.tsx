import React, { useState } from 'react';
import { SWRConfig } from 'swr';
import type { GridColDef, GridRowModesModel, GridRowsProp } from '@mui/x-data-grid';
import type { AlertProps } from '@mui/material';
import MeasurementsCommons, { type ViewDataMeasurementsCommonsProps } from './measurementscommons';

export const HARNESS_PAGE_SIZE = 10;

export interface MeasurementsGridHarnessProps {
  initialRows: GridRowsProp;
  gridColumns: GridColDef[];
  initialPage?: number;
  enableInfiniteScroll?: boolean;
  renderAboveGrid?: ViewDataMeasurementsCommonsProps['renderAboveGrid'];
  emptyCensusAction?: React.ReactNode;
  initialVisibleFilters?: ViewDataMeasurementsCommonsProps['initialVisibleFilters'];
}

export function MeasurementsGridHarness({
  initialRows,
  gridColumns,
  initialPage = 0,
  enableInfiniteScroll = false,
  renderAboveGrid,
  emptyCensusAction,
  initialVisibleFilters
}: MeasurementsGridHarnessProps) {
  const [rows, setRows] = useState<GridRowsProp>(initialRows);
  const [rowCount, setRowCount] = useState(initialRows.length);
  const [rowModesModel, setRowModesModel] = useState<GridRowModesModel>({});
  const [snackbar, setSnackbar] = useState<Pick<AlertProps, 'children' | 'severity'> | null>(null);
  const [refresh, setRefresh] = useState(false);
  const [paginationModel, setPaginationModel] = useState({ page: initialPage, pageSize: HARNESS_PAGE_SIZE });
  const [isNewRowAdded, setIsNewRowAdded] = useState(false);
  const [shouldAddRowAfterFetch, setShouldAddRowAfterFetch] = useState(false);
  return (
    <SWRConfig value={{ provider: () => new Map(), revalidateOnFocus: false, dedupingInterval: 0 }}>
      <MeasurementsCommons
        gridType="measurementssummary"
        gridColumns={gridColumns}
        initialVisibleFilters={initialVisibleFilters}
        rows={rows}
        setRows={setRows}
        rowCount={rowCount}
        setRowCount={setRowCount}
        rowModesModel={rowModesModel}
        setRowModesModel={setRowModesModel}
        snackbar={snackbar}
        setSnackbar={setSnackbar}
        refresh={refresh}
        setRefresh={setRefresh}
        paginationModel={paginationModel}
        setPaginationModel={setPaginationModel}
        isNewRowAdded={isNewRowAdded}
        setIsNewRowAdded={setIsNewRowAdded}
        shouldAddRowAfterFetch={shouldAddRowAfterFetch}
        setShouldAddRowAfterFetch={setShouldAddRowAfterFetch}
        addNewRowToGrid={() => undefined}
        enableInfiniteScroll={enableInfiniteScroll}
        renderAboveGrid={renderAboveGrid}
        emptyCensusAction={emptyCensusAction}
      />
    </SWRConfig>
  );
}
