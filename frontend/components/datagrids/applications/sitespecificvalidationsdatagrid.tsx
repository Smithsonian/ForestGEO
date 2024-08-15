'use client';

import React, { useState } from 'react';
import { GridRowsProp } from '@mui/x-data-grid';
import { AlertProps } from '@mui/material';
import { randomId } from '@mui/x-data-grid-generator';
import { SiteSpecificValidationsGridColumns } from '@/components/client/datagridcolumns';
import DataGridCommons from '@/components/datagrids/datagridcommons';
import { useSession } from 'next-auth/react';
import { initialSiteSpecificValidation } from '@/config/sqlrdsdefinitions/tables/sitespecificvalidationsrds';

export default function SiteSpecificValidationsDataGrid() {
  const [rows, setRows] = useState([initialSiteSpecificValidation] as GridRowsProp);
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
  const { data: session } = useSession();

  const addNewRowToGrid = () => {
    const id = randomId();
    const newRow = {
      ...initialSiteSpecificValidation,
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
      locked={session?.user?.userStatus !== 'db admin' && session?.user?.userStatus !== 'global'} // only global and db admins allowed to interact with this grid
      gridType="sitespecificvalidations"
      gridColumns={SiteSpecificValidationsGridColumns}
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
