'use client';

import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import React, { useEffect, useState } from 'react';
import { GridRowModes, GridRowModesModel, GridRowsProp } from '@mui/x-data-grid';
import { randomId } from '@mui/x-data-grid-generator';
import { Box, Button, Snackbar, Stack, Typography } from '@mui/joy';
import UploadParentModal from '@/components/uploadsystemhelpers/uploadparentmodal';
import MeasurementsCommons from '@/components/datagrids/measurementscommons';
import { MeasurementsSummaryViewGridColumns } from '@/components/client/datagridcolumns';
import { FormType } from '@/config/macros/formdetails';
import { MeasurementsSummaryRDS } from '@/config/sqlrdsdefinitions/views';
import MultilineModal from '@/components/datagrids/applications/multiline/multilinemodal';
import { useLoading } from '@/app/contexts/loadingprovider';
import { Alert, AlertProps, AlertTitle, Collapse } from '@mui/material';

const initialMeasurementsSummaryViewRDSRow: MeasurementsSummaryRDS = {
  id: 0,
  coreMeasurementID: 0,
  censusID: 0,
  quadratID: 0,
  plotID: 0,
  treeID: 0,
  stemID: 0,
  speciesID: 0,
  quadratName: '',
  speciesName: '',
  subspeciesName: '',
  speciesCode: '',
  treeTag: '',
  stemTag: '',
  localX: 0,
  localY: 0,
  coordinateUnits: '',
  measurementDate: null,
  measuredDBH: 0,
  dbhUnits: '',
  measuredHOM: 0,
  homUnits: '',
  isValidated: false,
  description: '',
  attributes: ''
};

export default function MeasurementsSummaryViewDataGrid() {
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isManualEntryFormOpen, setIsManualEntryFormOpen] = useState(false);
  const [triggerGlobalError, setTriggerGlobalError] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [openAlert, setOpenAlert] = useState(false);

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
  const { setLoading } = useLoading();

  async function reloadMSV() {
    setLoading(true, 'Refreshing Measurements View...');
    const response = await fetch(`/api/refreshviews/measurementssummary/${currentSite?.schemaName ?? ''}`, { method: 'POST' });
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (!response.ok) throw new Error('Measurements View Refresh failure');
  }

  useEffect(() => {
    reloadMSV()
      .catch(console.error)
      .then(() => setLoading(false));
  }, [refresh]);

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
          <Stack direction={'row'} spacing={2}>
            <Button onClick={() => setIsManualEntryFormOpen(true)} variant={'solid'} color={'primary'}>
              Manual Entry Form
            </Button>
            <Button onClick={() => setIsUploadModalOpen(true)} variant="solid" color="primary">
              Upload
            </Button>
          </Stack>
        </Box>
      </Box>
      <UploadParentModal
        isUploadModalOpen={isUploadModalOpen}
        handleCloseUploadModal={() => {
          setIsUploadModalOpen(false);
          setOpenAlert(true);
        }}
        formType={FormType.measurements}
      />
      <MultilineModal
        isManualEntryFormOpen={isManualEntryFormOpen}
        handleCloseManualEntryForm={() => {
          setIsManualEntryFormOpen(false);
          setOpenAlert(true);
        }}
        formType={'measurements'}
      />
      <MeasurementsCommons
        locked={true}
        gridType={'measurementssummary'}
        gridColumns={MeasurementsSummaryViewGridColumns}
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
      <Collapse in={openAlert} sx={{ width: '100%' }}>
        <Snackbar
          anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
          open={openAlert}
          autoHideDuration={6000}
          onClose={() => setOpenAlert(false)}
          sx={{ display: 'flex', flex: 1, alignSelf: 'center', justifySelf: 'center', alignItems: 'center', justifyContent: 'center' }}
        >
          <Alert variant={'outlined'} onClose={() => setOpenAlert(false)} severity="warning">
            <AlertTitle>Changes detected!</AlertTitle>
            Please press the refresh button to update the grid.
          </Alert>
        </Snackbar>
      </Collapse>
    </>
  );
}
