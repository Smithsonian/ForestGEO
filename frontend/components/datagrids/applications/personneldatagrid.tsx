// personnel datagrid
'use client';
import { GridRowModes, GridRowModesModel, GridRowsProp } from '@mui/x-data-grid';
import { AlertProps } from '@mui/material';
import React, { useState } from 'react';
import { initialPersonnelRDSRow } from '@/config/sqlrdsdefinitions/tables/personnelrds';
import { randomId } from '@mui/x-data-grid-generator';
import DataGridCommons from '@/components/datagrids/datagridcommons';
import { useSession } from 'next-auth/react';
import { Box, Button, Stack, Typography } from '@mui/joy';
import UploadParentModal from '@/components/uploadsystemhelpers/uploadparentmodal';
import Link from 'next/link';
import { PersonnelGridColumns } from '@/components/client/datagridcolumns';

export default function PersonnelDataGrid() {
  const [rows, setRows] = React.useState([initialPersonnelRDSRow] as GridRowsProp);
  const [rowCount, setRowCount] = useState(0); // total number of rows
  const [rowModesModel, setRowModesModel] = React.useState<GridRowModesModel>({});
  const [snackbar, setSnackbar] = React.useState<Pick<AlertProps, 'children' | 'severity'> | null>(null);
  const [refresh, setRefresh] = useState(false);
  const [paginationModel, setPaginationModel] = useState({
    page: 0,
    pageSize: 10
  });
  const [isNewRowAdded, setIsNewRowAdded] = useState<boolean>(false);
  const [shouldAddRowAfterFetch, setShouldAddRowAfterFetch] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const { data: session } = useSession();
  // Function to fetch paginated data
  const addNewRowToGrid = () => {
    const id = randomId();
    // New row object
    const nextPersonnelID = (rows.length > 0 ? rows.reduce((max, row) => Math.max(row.personnelID, max), 0) : 0) + 1;

    const newRow = {
      ...initialPersonnelRDSRow,
      id: id,
      personnelID: nextPersonnelID,
      isNew: true
    };

    // Add the new row to the state
    setRows(oldRows => [...oldRows, newRow]);
    // Set editing mode for the new row
    setRowModesModel(oldModel => ({
      ...oldModel,
      [id]: { mode: GridRowModes.Edit, fieldToFocus: 'firstName' }
    }));
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
            <Typography level={'title-md'} sx={{ color: '#ffa726' }}>
              Note: This is a locked view and will not allow modification.
            </Typography>
            <Typography level={'body-md'} sx={{ color: '#ffa726' }}>
              Please use this view as a way to confirm changes made to measurements.
            </Typography>
          </Box>

          {/* Upload Button */}
          <Stack direction="column">
            <Button onClick={() => setIsUploadModalOpen(true)} variant="solid" color="primary">
              Upload
            </Button>
            {/* Link to Quadrat Personnel Data Grid */}
            <Link href="/fixeddatainput/quadratpersonnel" passHref>
              <Button variant="solid" color="primary" sx={{ ml: 2 }}>
                View Quadrat Personnel
              </Button>
            </Link>
          </Stack>
        </Box>
      </Box>

      <UploadParentModal
        isUploadModalOpen={isUploadModalOpen}
        handleCloseUploadModal={() => {
          setIsUploadModalOpen(false);
          setRefresh(true);
        }}
        formType={'personnel'}
      />
      <DataGridCommons
        gridType="personnel"
        gridColumns={PersonnelGridColumns}
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
