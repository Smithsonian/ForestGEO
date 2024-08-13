'use client';

import React, { useState } from 'react';
import { GridRowsProp } from '@mui/x-data-grid';
import { AlertProps } from '@mui/material';
import { initialValidationProcedure } from '@/config/sqlrdsdefinitions/tables/validationproceduresrds';
import { randomId } from '@mui/x-data-grid-generator';
import { ValidationProceduresGridColumns } from '@/components/client/datagridcolumns';
import DataGridCommons from '@/components/datagrids/datagridcommons';

export default function ValidationProceduresDataGrid() {
  const [rows, setRows] = useState([initialValidationProcedure] as GridRowsProp);
  const [rowCount, setRowCount] = useState(0);
  const [rowModesModel, setRowModesModel] = useState({});
  const [snackbar, setSnackbar] = React.useState<Pick<AlertProps, 'children' | 'severity'> | null>(null);
  const [refresh, setRefresh] = useState(false);
  const [paginationModel, setPaginationModel] = useState({
    page: 0,
    pageSize: 10
  });
  const [isNewRowAdded, setIsNewRowAdded] = useState(false);
  const [shouldAddRowAfterFetch, setShouldAddRowAfterFetch] = useState(false);

  const addNewRowToGrid = () => {
    const id = randomId();
    const newRow = {
      ...initialValidationProcedure,
      id,
      isNew: true
    };

    setRows(oldRows => [...(oldRows ?? []), newRow]);
    setRowModesModel(oldModel => ({
      ...oldModel,
      [id]: { mode: 'edit', fieldToFocus: 'name' }
    }));
  };

  return (
    <DataGridCommons
      gridType="validationprocedures"
      gridColumns={ValidationProceduresGridColumns}
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
      addNewRowToGrid={addNewRowToGrid}
    />
  );
}
