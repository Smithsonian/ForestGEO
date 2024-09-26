// stemtaxonomiesview datagrid
'use client';
import { GridRowsProp } from '@mui/x-data-grid';
import { AlertProps } from '@mui/material';
import React, { useState } from 'react';
import { randomId } from '@mui/x-data-grid-generator';
import DataGridCommons from '@/components/datagrids/datagridcommons';
import { Box, Button, Typography } from '@mui/joy';
import { useSession } from 'next-auth/react';
import UploadParentModal from '@/components/uploadsystemhelpers/uploadparentmodal';
import { useOrgCensusContext } from '@/app/contexts/userselectionprovider';
import { StemTaxonomiesViewGridColumns } from '@/components/client/datagridcolumns';
import { FormType } from '@/config/macros/formdetails';
import { StemTaxonomiesViewRDS } from '@/config/sqlrdsdefinitions/views';

export default function StemTaxonomiesViewDataGrid() {
  const initialStemTaxonomiesViewRDSRow: StemTaxonomiesViewRDS = {
    id: 0,
    stemID: 0,
    treeID: 0,
    speciesID: 0,
    genusID: 0,
    familyID: 0,
    quadratID: 0,
    stemTag: '',
    treeTag: '',
    speciesCode: '',
    family: '',
    genus: '',
    speciesName: '',
    subspeciesName: '',
    validCode: '',
    genusAuthority: '',
    speciesAuthority: '',
    subspeciesAuthority: '',
    speciesIDLevel: '',
    speciesFieldFamily: ''
  };
  const [rows, setRows] = useState([initialStemTaxonomiesViewRDSRow] as GridRowsProp);
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
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const { data: session } = useSession();
  const currentCensus = useOrgCensusContext();

  const addNewRowToGrid = () => {
    const id = randomId();
    const newRow = {
      ...initialStemTaxonomiesViewRDSRow,
      id,
      isNew: true
    };

    setRows(oldRows => [...(oldRows ?? []), newRow]);
    setRowModesModel(oldModel => ({
      ...oldModel,
      [id]: { mode: 'edit', fieldToFocus: 'stemTag' }
    }));
    console.log('attributes addnewrowtogrid triggered');
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

          {/* Upload Button */}
          <Button onClick={() => setIsUploadModalOpen(true)} variant="solid" color="primary">
            Upload
          </Button>
        </Box>
      </Box>

      <UploadParentModal
        isUploadModalOpen={isUploadModalOpen}
        handleCloseUploadModal={() => {
          setIsUploadModalOpen(false);
          setRefresh(true);
        }}
        formType={FormType.species}
      />

      <DataGridCommons
        gridType="stemtaxonomiesview"
        gridColumns={StemTaxonomiesViewGridColumns}
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
