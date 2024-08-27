'use client';

import { useOrgCensusContext, usePlotContext } from '@/app/contexts/userselectionprovider';
import React, { useState } from 'react';
import { GridRowModes, GridRowModesModel, GridRowsProp } from '@mui/x-data-grid';
import { Alert, AlertProps } from '@mui/material';
import { randomId } from '@mui/x-data-grid-generator';
import { Box, Button, Snackbar, Stack, Typography } from '@mui/joy';
import UploadParentModal from '@/components/uploadsystemhelpers/uploadparentmodal';
import MeasurementsCommons from '@/components/datagrids/measurementscommons';
import { measurementsSummaryViewGridColumns } from '@/components/client/datagridcolumns';
import { FormType } from '@/config/macros/formdetails';
import { initialMeasurementsSummaryViewRDSRow } from '@/config/sqlrdsdefinitions/views';

export default function MeasurementsSummaryViewDataGrid() {
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [triggerGlobalError, setTriggerGlobalError] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const [rows, setRows] = React.useState([initialMeasurementsSummaryViewRDSRow] as GridRowsProp);
  const [rowCount, setRowCount] = useState(0);
  const [rowModesModel, setRowModesModel] = React.useState<GridRowModesModel>({});
  const [snackbar, setSnackbar] = React.useState<Pick<AlertProps, 'children' | 'severity'> | null>(null);
  const [refresh, setRefresh] = useState(false);
  const [paginationModel, setPaginationModel] = useState({
    page: 0,
    pageSize: 10
  });
  const [isNewRowAdded, setIsNewRowAdded] = useState<boolean>(false);
  const [shouldAddRowAfterFetch, setShouldAddRowAfterFetch] = useState(false);

  const addNewRowToGrid = () => {
    const id = randomId();
    // Define new row structure based on MeasurementsSummaryRDS type
    const newRow = {
      ...initialMeasurementsSummaryViewRDSRow,
      id: id,
      coreMeasurementID: 0,
      plotID: currentPlot?.plotID,
      plotName: currentPlot?.plotName,
      censusID: currentCensus?.dateRanges[0].censusID,
      censusStartDate: currentCensus?.dateRanges[0]?.startDate,
      censusEndDate: currentCensus?.dateRanges[0]?.endDate,
      isNew: true
    };
    setRows(oldRows => [...oldRows, newRow]);
    setRowModesModel(oldModel => ({
      ...oldModel,
      [id]: { mode: GridRowModes.Edit }
    }));
  };

  const handleCloseGlobalError = () => {
    setGlobalError(null);
    setTriggerGlobalError(false);
  };

  return (
    <>
      {globalError && (
        <Snackbar open={triggerGlobalError} autoHideDuration={6000} onClose={handleCloseGlobalError}>
          <Alert onClose={handleCloseGlobalError} severity="error">
            {globalError}
          </Alert>
        </Snackbar>
      )}
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
          <Stack direction="column">
            <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
              <Box
                sx={{
                  flex: 1,
                  display: 'flex',
                  justifyContent: 'left',
                  flexDirection: 'column',
                  marginTop: 2
                }}
              >
                <Typography level={'title-md'} sx={{ color: '#ffa726' }}>
                  Note: This plot does not accept subquadrats. <br />
                  Please ensure that you use quadrat names when submitting new measurements instead of subquadrat names
                </Typography>
              </Box>
            </Box>
          </Stack>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Button onClick={() => setIsUploadModalOpen(true)}>Upload</Button>
          </Box>
        </Box>
      </Box>
      <UploadParentModal
        isUploadModalOpen={isUploadModalOpen}
        handleCloseUploadModal={() => {
          setIsUploadModalOpen(false);
          setRefresh(true);
        }}
        formType={FormType.measurements}
      />
      <MeasurementsCommons
        gridType={'measurementssummary'}
        gridColumns={measurementsSummaryViewGridColumns}
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
