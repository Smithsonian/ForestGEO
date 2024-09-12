// quadrats datagrid
'use client';
import { GridRowModes, GridRowModesModel, GridRowsProp } from '@mui/x-data-grid';
import { AlertProps } from '@mui/material';
import React, { useState } from 'react';
import { useOrgCensusContext, usePlotContext } from '@/app/contexts/userselectionprovider';
import { randomId } from '@mui/x-data-grid-generator';
import DataGridCommons from '@/components/datagrids/datagridcommons';
import { Box, Button, Typography } from '@mui/joy';
import { useSession } from 'next-auth/react';
import UploadParentModal from '@/components/uploadsystemhelpers/uploadparentmodal';
import Link from 'next/link';
import { quadratGridColumns } from '@/components/client/datagridcolumns';
import { FormType } from '@/config/macros/formdetails';
import { QuadratRDS } from '@/config/sqlrdsdefinitions/zones';

export default function QuadratsDataGrid() {
  const initialQuadratRDSRow: QuadratRDS = {
    id: 0,
    quadratID: 0,
    plotID: 0,
    censusID: 0,
    quadratName: '',
    startX: 0,
    startY: 0,
    coordinateUnits: '',
    dimensionX: 0,
    dimensionY: 0,
    dimensionUnits: '',
    area: 0,
    areaUnits: '',
    quadratShape: ''
  };
  const [rows, setRows] = React.useState([initialQuadratRDSRow] as GridRowsProp);
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
  const { data: session } = useSession();
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();

  const addNewRowToGrid = () => {
    const id = randomId();
    const nextQuadratID = (rows.length > 0 ? rows.reduce((max, row) => Math.max(row.quadratID, max), 0) : 0) + 1;
    const newRow = {
      ...initialQuadratRDSRow,
      id: id,
      quadratID: nextQuadratID,
      plotID: currentPlot ? currentPlot.id : 0,
      censusID: currentCensus ? currentCensus.dateRanges[0].censusID : 0,
      isNew: true
    };
    // Add the new row to the state
    setRows(oldRows => [...oldRows, newRow]);
    // Set editing mode for the new row
    setRowModesModel(oldModel => ({
      ...oldModel,
      [id]: { mode: GridRowModes.Edit, fieldToFocus: 'quadratName' }
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
          <Button
            onClick={() => {
              setIsUploadModalOpen(true);
            }}
            color={'primary'}
          >
            Upload Quadrats
          </Button>
          {/* Link to Quadrat Personnel Data Grid */}
          <Link href="/fixeddatainput/quadratpersonnel" passHref>
            <Button variant="solid" color="primary" sx={{ ml: 2 }}>
              View Quadrat Personnel
            </Button>
          </Link>
        </Box>
      </Box>
      <UploadParentModal
        isUploadModalOpen={isUploadModalOpen}
        handleCloseUploadModal={() => {
          setIsUploadModalOpen(false);
          setRefresh(true);
        }}
        formType={FormType.quadrats}
      />
      <DataGridCommons
        gridType="quadrats"
        gridColumns={quadratGridColumns}
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
