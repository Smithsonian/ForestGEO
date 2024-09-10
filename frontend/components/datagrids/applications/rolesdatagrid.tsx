// roles datagrid
'use client';
import { GridRowModes, GridRowsProp } from '@mui/x-data-grid';
import { AlertProps } from '@mui/material';
import React, { useState } from 'react';
import { randomId } from '@mui/x-data-grid-generator';
import DataGridCommons from '@/components/datagrids/datagridcommons';
import { Box, Typography } from '@mui/joy';
import { useSession } from 'next-auth/react';
import { RolesGridColumns } from '@/components/client/datagridcolumns';
import { RoleRDS } from '@/config/sqlrdsdefinitions/personnel';

export default function RolesDataGrid() {
  const initialRoleRDSRow: RoleRDS = {
    id: 0,
    roleID: 0,
    roleName: '',
    roleDescription: ''
  };
  const [rows, setRows] = useState([initialRoleRDSRow] as GridRowsProp);
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
    if (isNewRowAdded) return; // Prevent double add

    const id = randomId();
    console.log('Generated ID:', id);

    const newRow = { ...initialRoleRDSRow, id, isNew: true };
    setRows(oldRows => {
      console.log('Before adding new row:', oldRows);
      const updatedRows = [...(oldRows ?? []), newRow];
      console.log('After adding new row:', updatedRows);
      return updatedRows;
    });

    setRowModesModel(oldModel => ({
      ...oldModel,
      [id]: { mode: GridRowModes.Edit, fieldToFocus: 'roleName' }
    }));
    setIsNewRowAdded(true);
  };

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3, width: '100%' }}>
        <Box
          sx={{
            width: '100%',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: 'warning.main',
            borderRadius: '4px',
            p: 2
          }}
        >
          <Box sx={{ flexGrow: 1 }}>
            {session?.user.userStatus !== 'field crew' && (
              <Typography level={'title-lg'} sx={{ color: '#ffa726' }}>
                Note: ADMINISTRATOR VIEW
              </Typography>
            )}
          </Box>
        </Box>
      </Box>

      <DataGridCommons
        gridType="roles"
        gridColumns={RolesGridColumns}
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
    </>
  );
}
