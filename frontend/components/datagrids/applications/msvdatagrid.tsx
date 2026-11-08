// msvdatagrid.tsx
'use client';

import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/compat-hooks';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GridRowModes, GridRowModesModel, GridRowsProp } from '@mui/x-data-grid';
import { randomId } from '@mui/x-data-grid-generator';
import { Snackbar } from '@mui/joy';
import UploadParentModal from '@/components/uploadsystemhelpers/uploadparentmodal';
import MeasurementsCommons from '@/components/datagrids/measurementscommons';
import { MeasurementsSummaryViewGridColumns } from '@/components/client/datagridcolumns';
import { DatagridType, FormType, SourceFormat } from '@/config/macros/formdetails';
import { MeasurementsSummaryRDS } from '@/lib/db/definitions/views';
import MultilineModal from '@/components/datagrids/applications/multiline/multilinemodal';
import { Alert, AlertProps } from '@mui/material';
import { useLoading } from '@/app/contexts/loadingprovider';
import FailedMeasurementsModal from '@/components/client/modals/failedmeasurementsmodal';
import ailogger from '@/ailogger';
import { useRouter } from 'next/navigation';
import { VisibleFilter } from '@/config/datagridhelpers';
import { getPersistedGridPageSize } from '@/components/datagrids/customgridpagination';
import { useSession } from 'next-auth/react';
import ViewDataHeader, { AddMeasurementsMenu } from '@/components/viewdata/viewdataheader';
import ViewDataFilterBar from '@/components/viewdata/viewdatafilterbar';
import type { ViewDataAboveGridControls } from '@/components/viewdata/viewdatacontrols';
import HeaderReferenceDialog from '@/components/client/modals/headerreferencedialog';
import { canEditMeasurementRows, formatViewDataScopeLine } from '@/config/viewdata';

// Identity under which CustomGridPagination persists the rows-per-page choice;
// the initializer below must read the same key.
const MEASUREMENTS_SUMMARY_GRID_TYPE = 'measurementssummary';

const initialMeasurementsSummaryViewRDSRow: MeasurementsSummaryRDS = {
  id: 0,
  coreMeasurementID: 0,
  censusID: 0,
  quadratID: 0,
  plotID: 0,
  treeID: 0,
  stemGUID: 0,
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

interface MeasurementsSummaryViewDataGridProps {
  autoOpenFailedMeasurements?: boolean;
  failedMeasurementsCloseRedirectHref?: string;
  initialVisibleFilters?: VisibleFilter[];
  showToolbarActions?: boolean;
}

export default function MeasurementsSummaryViewDataGrid({
  autoOpenFailedMeasurements = false,
  failedMeasurementsCloseRedirectHref,
  initialVisibleFilters,
  showToolbarActions = true
}: MeasurementsSummaryViewDataGridProps) {
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const currentSite = useSiteContext();
  const { setLoading } = useLoading();
  const router = useRouter();
  const { data: session } = useSession();
  const canRecoverFailedRows = Boolean(session?.user?.userStatus && session.user.userStatus !== 'pending');
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isArcgisUploadOpen, setIsArcgisUploadOpen] = useState(false);
  const [isManualEntryFormOpen, setIsManualEntryFormOpen] = useState(false);
  const [triggerGlobalError, setTriggerGlobalError] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [isHeaderReferenceOpen, setIsHeaderReferenceOpen] = useState(false);
  const [openFSM, setOpenFSM] = useState(false);
  const [isReingesting, setIsReingesting] = useState(false);
  const [uploadCompleted, setUploadCompleted] = useState(false);
  const [manualEntryCompleted, setManualEntryCompleted] = useState(false);

  const [rows, setRows] = React.useState([initialMeasurementsSummaryViewRDSRow] as GridRowsProp);
  const [rowCount, setRowCount] = useState(0);
  const [rowModesModel, setRowModesModel] = React.useState<GridRowModesModel>({});
  const [snackbar, setSnackbar] = React.useState<Pick<AlertProps, 'children' | 'severity'> | null>(null);
  const [refresh, setRefresh] = useState(false);
  const [paginationModel, setPaginationModel] = useState(() => ({
    page: 0,
    pageSize: getPersistedGridPageSize(MEASUREMENTS_SUMMARY_GRID_TYPE)
  }));
  const [isNewRowAdded, setIsNewRowAdded] = useState<boolean>(false);
  const [shouldAddRowAfterFetch, setShouldAddRowAfterFetch] = useState(false);
  const hasAutoOpenedFailedMeasurementsRef = useRef(false);
  const failedCountAbortControllerRef = useRef<AbortController | null>(null);
  const failedMeasurementsScope =
    currentSite?.schemaName && currentPlot?.plotID && currentCensus?.dateRanges?.[0]?.censusID
      ? `${currentSite.schemaName}:${currentPlot.plotID}:${currentCensus.dateRanges[0].censusID}`
      : '';
  const [failedRowCountState, setFailedRowCountState] = useState({ scope: '', count: 0 });
  const failedRowCount = failedRowCountState.scope === failedMeasurementsScope ? failedRowCountState.count : 0;

  // Use a site-scoped read endpoint. The similarly named /api/admin/clear
  // endpoint is deliberately admin-only, while failed-row recovery is
  // available to every role that may edit measurements for this site.
  const fetchFailedRowCount = useCallback(async () => {
    failedCountAbortControllerRef.current?.abort();

    if (!canRecoverFailedRows || !currentSite?.schemaName || !currentPlot?.plotID || !currentCensus?.dateRanges?.[0]?.censusID || !failedMeasurementsScope) {
      setFailedRowCountState({ scope: '', count: 0 });
      return;
    }

    const controller = new AbortController();
    failedCountAbortControllerRef.current = controller;
    const requestScope = failedMeasurementsScope;

    try {
      const response = await fetch(
        `/api/failedmeasurements/count/${encodeURIComponent(currentSite.schemaName)}/${currentPlot.plotID}/${currentCensus.dateRanges[0].censusID}`,
        { method: 'GET', signal: controller.signal }
      );
      if (!response.ok) {
        throw new Error(`Failed-measurement count request returned ${response.status}`);
      }

      const data = await response.json();
      const recordCount = data.recordCount;
      if (typeof recordCount !== 'number' || !Number.isSafeInteger(recordCount) || recordCount < 0) {
        throw new Error('Failed-measurement count response was invalid');
      }

      if (!controller.signal.aborted && failedCountAbortControllerRef.current === controller) {
        setFailedRowCountState({ scope: requestScope, count: recordCount });
        setGlobalError(null);
        setTriggerGlobalError(false);
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') return;
      const err = error instanceof Error ? error : new Error(String(error));
      ailogger.error(`Failed to fetch failed-measurement count for ${requestScope}:`, err);
      if (!controller.signal.aborted && failedCountAbortControllerRef.current === controller) {
        setFailedRowCountState({ scope: requestScope, count: 0 });
        setGlobalError('Unable to load the failed-measurement count. Refresh the page to try again.');
        setTriggerGlobalError(true);
      }
    } finally {
      if (failedCountAbortControllerRef.current === controller) {
        failedCountAbortControllerRef.current = null;
      }
    }
  }, [canRecoverFailedRows, currentSite?.schemaName, currentPlot?.plotID, currentCensus?.dateRanges?.[0]?.censusID, failedMeasurementsScope]);

  useEffect(() => {
    void fetchFailedRowCount();
    return () => failedCountAbortControllerRef.current?.abort();
  }, [fetchFailedRowCount]);

  useEffect(() => {
    if (!autoOpenFailedMeasurements || hasAutoOpenedFailedMeasurementsRef.current) {
      return;
    }

    hasAutoOpenedFailedMeasurementsRef.current = true;
    setOpenFSM(true);
  }, [autoOpenFailedMeasurements]);

  const addNewRowToGrid = () => {
    const id = randomId();
    const newRow = {
      ...initialMeasurementsSummaryViewRDSRow,
      id: id,
      coreMeasurementID: 0,
      plotID: currentPlot?.plotID,
      plotName: currentPlot?.plotName,
      censusID: currentCensus?.dateRanges?.[0]?.censusID,
      censusStartDate: currentCensus?.dateRanges?.[0]?.startDate,
      censusEndDate: currentCensus?.dateRanges?.[0]?.endDate,
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
      // destructive mutation — global overlay blocks UI for the duration of the API call
      setLoading(true, 'Refreshing Measurements View...');
      const body =
        currentPlot?.plotID != null && currentCensus?.dateRanges?.[0]?.censusID != null
          ? JSON.stringify({
              plotID: currentPlot.plotID,
              censusID: currentCensus.dateRanges[0].censusID
            })
          : undefined;
      const response = await fetch(`/api/refreshviews/measurementssummary/${currentSite?.schemaName ?? ''}`, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body
      });
      if (!response.ok) throw new Error('Measurements View Refresh failure');
    } catch (e: any) {
      ailogger.error(e);
    } finally {
      setLoading(false);
      setRefresh(true);
      // Uploads and reingestion runs both land here; either can change how
      // many rows are stuck as failed.
      void fetchFailedRowCount();
    }
  }

  const handleCloseFailedMeasurementsModal = async ({ dataChanged = false }: { dataChanged?: boolean } = {}) => {
    // Close immediately; refreshing the summary must not trap the user behind
    // the modal while a network request is in flight.
    setOpenFSM(false);

    if (dataChanged) {
      await reloadMSV();
    } else if (!failedMeasurementsCloseRedirectHref) {
      void fetchFailedRowCount();
    }

    if (failedMeasurementsCloseRedirectHref) {
      router.replace(failedMeasurementsCloseRedirectHref);
    }
  };

  const addMeasurementsHandlers = useMemo(
    () => ({
      onManualEntry: () => setIsManualEntryFormOpen(true),
      onUploadCsv: () => setIsUploadModalOpen(true),
      onImportArcgis: () => setIsArcgisUploadOpen(true)
    }),
    []
  );
  const emptyCensusAction = useMemo(
    () => (showToolbarActions ? <AddMeasurementsMenu {...addMeasurementsHandlers} /> : null),
    [showToolbarActions, addMeasurementsHandlers]
  );
  const isReadOnly = !canEditMeasurementRows(session?.user?.userStatus);

  const renderAboveGrid = (controls: ViewDataAboveGridControls) => (
    <>
      <ViewDataHeader
        scopeLine={formatViewDataScopeLine(currentSite?.siteName, currentPlot?.plotName, currentCensus?.plotCensusNumber)}
        stateCounts={controls.stateCounts}
        isReadOnly={isReadOnly}
        showActions={showToolbarActions}
        failedUploadCount={failedRowCount}
        canFixFailedUploads={canRecoverFailedRows}
        onFixFailedUploads={() => setOpenFSM(true)}
        onExportCsv={controls.onOpenExport}
        onRunValidations={controls.onRunValidations}
        onOverrideValidations={controls.onOverrideValidations}
        onResetValidations={controls.onResetValidations}
        onRefreshView={reloadMSV}
        onOpenHeaderReference={() => setIsHeaderReferenceOpen(true)}
        {...addMeasurementsHandlers}
      />
      <ViewDataFilterBar
        stateCounts={controls.stateCounts}
        showOption={controls.showOption}
        onShowOptionChange={controls.onShowOptionChange}
        searchText={controls.searchText}
        appliedSearchText={controls.appliedSearchText}
        onSearchTextChange={controls.onSearchTextChange}
        onSearchApply={controls.onSearchApply}
        onSearchClear={controls.onSearchClear}
      />
    </>
  );

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
          const wasCompleted = uploadCompleted;
          setIsUploadModalOpen(false);
          setIsReingesting(false);
          setUploadCompleted(false);
          if (wasCompleted) {
            void reloadMSV();
          }
        }}
        formType={FormType.measurements}
        skipToProcessing={isReingesting}
        onUploadComplete={() => setUploadCompleted(true)}
      />
      <UploadParentModal
        isUploadModalOpen={isArcgisUploadOpen}
        handleCloseUploadModal={() => {
          const wasCompleted = uploadCompleted;
          setIsArcgisUploadOpen(false);
          setUploadCompleted(false);
          if (wasCompleted) {
            void reloadMSV();
          }
        }}
        formType={FormType.measurements}
        sourceFormat={SourceFormat.arcgis_xlsx}
        onUploadComplete={() => setUploadCompleted(true)}
      />
      <MultilineModal
        isManualEntryFormOpen={isManualEntryFormOpen}
        handleCloseManualEntryForm={() => {
          if (manualEntryCompleted) {
            reloadMSV().then(() => {
              setIsManualEntryFormOpen(false);
              setManualEntryCompleted(false);
            });
          } else {
            setIsManualEntryFormOpen(false);
          }
        }}
        formType={'measurements'}
        onSubmitComplete={() => setManualEntryCompleted(true)}
      />
      <FailedMeasurementsModal open={openFSM} handleCloseModal={handleCloseFailedMeasurementsModal} autoCloseWhenEmpty={!autoOpenFailedMeasurements} />
      <HeaderReferenceDialog open={isHeaderReferenceOpen} onClose={() => setIsHeaderReferenceOpen(false)} datagridType={DatagridType.measurementssummaryview} />
      <MeasurementsCommons
        gridType={MEASUREMENTS_SUMMARY_GRID_TYPE}
        gridColumns={MeasurementsSummaryViewGridColumns}
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
        addNewRowToGrid={addNewRowToGrid}
        renderAboveGrid={renderAboveGrid}
        emptyCensusAction={emptyCensusAction}
        enablePageJump
        enableInfiniteScroll
      />
    </>
  );
}
