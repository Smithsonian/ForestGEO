'use client';

import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import React, { useState } from 'react';
import { GridRowModes, GridRowModesModel, GridRowsProp } from '@mui/x-data-grid';
import { randomId } from '@mui/x-data-grid-generator';
import { Snackbar, Typography } from '@mui/joy';
import UploadParentModal from '@/components/uploadsystemhelpers/uploadparentmodal';
import MeasurementsCommons from '@/components/datagrids/measurementscommons';
import { MeasurementsSummaryViewGridColumns } from '@/components/client/datagridcolumns';
import { FormType } from '@/config/macros/formdetails';
import { MeasurementsSummaryRDS } from '@/config/sqlrdsdefinitions/views';
import MultilineModal from '@/components/datagrids/applications/multiline/multilinemodal';
import { Alert, AlertProps, AlertTitle, Collapse } from '@mui/material';
import { useLoading } from '@/app/contexts/loadingprovider';
import FailedMeasurementsModal from '@/components/client/failedmeasurementsmodal';
import { AssignmentOutlined, CachedOutlined, RuleOutlined, UploadFileOutlined } from '@mui/icons-material';

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
  stemLocalX: 0,
  stemLocalY: 0,
  measurementDate: null,
  measuredDBH: 0,
  measuredHOM: 0,
  isValidated: false,
  description: '',
  attributes: '',
  userDefinedFields: '',
  errors: ''
};

export default function MeasurementsSummaryViewDataGrid() {
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const currentSite = useSiteContext();
  const { setLoading } = useLoading();
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isManualEntryFormOpen, setIsManualEntryFormOpen] = useState(false);
  const [triggerGlobalError, setTriggerGlobalError] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [openAlert, setOpenAlert] = useState(false);
  const [openViewResetAlert, setOpenViewResetAlert] = useState(false);
  const [openFSM, setOpenFSM] = useState(false);

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

  async function reloadMSV() {
    try {
      setLoading(true, 'Refreshing Measurements View...');
      const response = await fetch(`/api/refreshviews/measurementssummary/${currentSite?.schemaName ?? ''}`, { method: 'POST' });
      if (!response.ok) throw new Error('Measurements View Refresh failure');
      setLoading(true, 'Processing data...');
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (e: any) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefresh(true);
    }
  }

  return (
    <>
      {globalError && (
        <Snackbar open={triggerGlobalError} autoHideDuration={6000} onClose={handleCloseGlobalError}>
          <Alert onClose={handleCloseGlobalError} severity="error">
            {globalError}
          </Alert>
        </Snackbar>
      )}
      <UploadParentModal
        isUploadModalOpen={isUploadModalOpen}
        handleCloseUploadModal={() => {
          reloadMSV().then(() => {
            setIsUploadModalOpen(false);
            setOpenAlert(true);
          });
        }}
        formType={FormType.measurements}
      />
      <MultilineModal
        isManualEntryFormOpen={isManualEntryFormOpen}
        handleCloseManualEntryForm={() => {
          reloadMSV().then(() => {
            setIsManualEntryFormOpen(false);
            setOpenAlert(true);
          });
        }}
        formType={'measurements'}
      />
      <FailedMeasurementsModal
        open={openFSM}
        handleCloseModal={async () => {
          setOpenFSM(false);
          setOpenViewResetAlert(true);
        }}
      />
      <MeasurementsCommons
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
        dynamicButtons={[
          {
            label: 'Manual Entry Form',
            onClick: () => setIsManualEntryFormOpen(true),
            tooltip: 'Submit data by filling out a form',
            icon: <AssignmentOutlined />
          },
          { label: 'Upload', onClick: () => setIsUploadModalOpen(true), tooltip: 'Submit data by uploading a CSV file', icon: <UploadFileOutlined /> },
          { label: 'Reset View', onClick: async () => await reloadMSV(), tooltip: 'Manually reload the view', icon: <CachedOutlined /> },
          { label: 'Review Failed Msmts', onClick: () => setOpenFSM(true), tooltip: 'Review and correct failed measurements.', icon: <RuleOutlined /> }
        ]}
      />
      <Collapse in={openAlert || openViewResetAlert} sx={{ width: '100%' }}>
        <Snackbar
          anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
          open={openAlert}
          autoHideDuration={6000}
          onClose={() => setOpenAlert(false)}
          variant={'plain'}
          sx={{ display: 'flex', flex: 1, alignSelf: 'center', justifySelf: 'center', alignItems: 'center', justifyContent: 'center' }}
        >
          <Alert variant={'standard'} onClose={() => setOpenAlert(false)}>
            <AlertTitle>Changes detected!</AlertTitle>
            Please press the refresh button to update the grid.
          </Alert>
        </Snackbar>
        <Snackbar
          anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
          open={openViewResetAlert}
          autoHideDuration={6000}
          onClose={() => setOpenViewResetAlert(false)}
          variant={'plain'}
          sx={{ display: 'flex', flex: 1, alignSelf: 'center', justifySelf: 'center', alignItems: 'center', justifyContent: 'center' }}
        >
          <Alert variant={'outlined'} onClose={() => setOpenViewResetAlert(false)} sx={{ display: 'flex', flex: 1, width: '100%', flexDirection: 'column' }}>
            <AlertTitle>CORE CHANGES DETECTED!</AlertTitle>
            <Typography fontWeight={'bold'}>You must reset the view to see your changes.</Typography>
            <Typography fontWeight={'bold'}>Press the view reset button!</Typography>
          </Alert>
        </Snackbar>
      </Collapse>
    </>
  );
}
