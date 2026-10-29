'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/joy';
import {
  useOrgCensusContext,
  useOrgCensusDispatch,
  useOrgCensusListContext,
  useOrgCensusListDispatch,
  usePlotContext,
  useSiteContext
} from '@/app/contexts/compat-hooks';
import { useLoading } from '@/app/contexts/loadingprovider';
import CensusStatTiles from '@/components/dashboard/censusstattiles';
import CensusSummaryPanels from '@/components/dashboard/censussummarypanels';
import PublishBlockerCallout from '@/components/dashboard/publishblockercallout';
import CensusOverviewActionsMenu from '@/components/dashboard/censusoverviewactionsmenu';
import { useCensusOverviewSummary } from '@/app/hooks/usecensusoverviewsummary';
import { getDateRangeCensusIDs } from '@/lib/censusscope';
import DataQualityCard from '@/components/dashboard/dataqualitycard';
import PublishCensusButton from '@/components/dashboard/publishcensusbutton';
import CensusDeletionModal from '@/components/client/modals/censusdeletionmodal';
import { createAndUpdateCensusList, OrgCensusRDS, reconcileCurrentCensusSelection } from '@/lib/db/definitions/timekeeping';
import ailogger from '@/ailogger';
import { useIsMounted } from '@/app/hooks/useismounted';
import { useSession } from 'next-auth/react';
import {
  CENSUS_DELETE_GENERIC_FAILURE_MESSAGE,
  CENSUS_DELETE_STALE_LIST_STATUSES,
  getCensusDeleteBlockReason,
  readCensusDeleteRejectionMessage
} from '@/config/censusdeletion';
import { CENSUS_OVERVIEW_TEXT, formatCensusDateRange } from '@/config/censusoverview';

interface ProgressTachoType {
  TotalQuadrats: number;
  PopulatedQuadrats: number;
  PopulatedPercent: number;
  UnpopulatedQuadrats: string[];
}

interface StemTypesType {
  CountOldStems: number | null;
  CountMultiStems: number;
  CountNewRecruits: number;
  isFirstCensus: boolean;
}

export default function CensusOverviewPage() {
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const censusListContext = useOrgCensusListContext();
  const censusListDispatch = useOrgCensusListDispatch();
  const censusDispatch = useOrgCensusDispatch();
  const { isMountedRef } = useIsMounted();
  const { data: session } = useSession();
  const { setLoading } = useLoading();
  const metricsAbortControllerRef = useRef<AbortController | null>(null);

  const [censusToDelete, setCensusToDelete] = useState<OrgCensusRDS | null>(null);
  const [openDeleteCensusModal, setOpenDeleteCensusModal] = useState(false);
  const [isDeletingCensus, setIsDeletingCensus] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [countTrees, setCountTrees] = useState(0);
  const [countStems, setCountStems] = useState(0);
  // CountOldStems starts null so the tile shows the "no comparison" placeholder
  // instead of a confident 0 until real data arrives.
  const [stemTypes, setStemTypes] = useState<StemTypesType>({ CountOldStems: null, CountMultiStems: 0, CountNewRecruits: 0, isFirstCensus: false });
  const [progressTacho, setProgressTacho] = useState<ProgressTachoType>({
    TotalQuadrats: 0,
    PopulatedQuadrats: 0,
    PopulatedPercent: 0,
    UnpopulatedQuadrats: []
  });
  const [isLoading, setIsLoading] = useState(false);
  const censusSummary = useCensusOverviewSummary({
    schema: currentSite?.schemaName,
    plotID: currentPlot?.plotID,
    censusID: currentCensus?.dateRanges?.[0]?.censusID,
    errorCensusIDs: getDateRangeCensusIDs(currentCensus)
  });
  const refetchCensusSummary = censusSummary.refetch;

  useEffect(() => {
    return () => {
      metricsAbortControllerRef.current?.abort();
    };
  }, []);

  const loadMetrics = useCallback(async () => {
    if (!currentSite?.schemaName || !currentPlot?.plotID || !currentCensus?.dateRanges?.[0]?.censusID) return;

    metricsAbortControllerRef.current?.abort();
    metricsAbortControllerRef.current = new AbortController();
    setIsLoading(true);

    try {
      const response = await fetch(`/api/dashboardmetrics/all/${currentSite.schemaName}/${currentPlot.plotID}/${currentCensus.dateRanges[0].censusID}`, {
        signal: metricsAbortControllerRef.current.signal
      });

      if (!isMountedRef.current) return;
      if (!response.ok) throw new Error(`Failed to load metrics: ${response.status}`);

      const data = await response.json();
      if (!isMountedRef.current) return;

      setProgressTacho({
        TotalQuadrats: data.progressTachometer.TotalQuadrats,
        PopulatedQuadrats: data.progressTachometer.PopulatedQuadrats,
        PopulatedPercent: data.progressTachometer.PopulatedPercent,
        UnpopulatedQuadrats: data.progressTachometer.UnpopulatedQuadrats ? data.progressTachometer.UnpopulatedQuadrats.split(';') : []
      });
      setCountTrees(data.countTrees.CountTrees);
      setCountStems(data.countStems.CountStems);
      setStemTypes({
        CountOldStems: data.stemTypes.CountOldStems,
        CountMultiStems: data.stemTypes.CountMultiStems,
        CountNewRecruits: data.stemTypes.CountNewRecruits,
        isFirstCensus: data.stemTypes.isFirstCensus
      });
    } catch (e: any) {
      if (e.name === 'AbortError') return;
      if (!isMountedRef.current) return;
      ailogger.error('Census overview metrics error:', e);
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  }, [currentSite?.schemaName, currentPlot?.plotID, currentCensus?.dateRanges?.[0]?.censusID]);

  useEffect(() => {
    loadMetrics();
  }, [loadMetrics]);

  // Refetch the census list after a deletion so the sidebar/context reflect the change.
  // Mirrors the dashboard: reconcile (not clear) the current selection, so no explicit
  // markExplicitSelectionClear is needed — measurements-only deletion leaves the census row intact.
  const currentCensusID = currentCensus?.dateRanges?.[0]?.censusID;
  const refreshCensusList = useCallback(async () => {
    if (!currentSite?.schemaName || !currentPlot?.plotID) return;

    try {
      const response = await fetch(
        `/api/fetchall/census/${currentPlot.plotID}/${currentCensus?.plotCensusNumber ?? 0}?schema=${currentSite.schemaName}&plotID=${currentPlot.plotID}`
      );
      if (!response.ok) throw new Error(`Failed to load census data: ${response.status}`);
      const censusRDSLoad = await response.json();
      const censusArray = Array.isArray(censusRDSLoad) ? censusRDSLoad : [];
      const updatedCensusList = await createAndUpdateCensusList(censusArray);
      if (censusListDispatch) await censusListDispatch({ censusList: updatedCensusList });
      if (censusDispatch && currentCensus) {
        const reconciledCensus = reconcileCurrentCensusSelection(currentCensus, updatedCensusList);
        await censusDispatch({ census: reconciledCensus });
      }
    } catch (error) {
      ailogger.error('Failed to refresh census list after deletion', error instanceof Error ? error : undefined);
      throw error;
    }
  }, [currentSite?.schemaName, currentPlot?.plotID, currentCensus?.plotCensusNumber, currentCensusID, censusListDispatch, censusDispatch]);

  const handleCensusDelete = useCallback((census: OrgCensusRDS) => {
    setCensusToDelete(census);
    setOpenDeleteCensusModal(true);
  }, []);

  const handleConfirmDeleteCensus = useCallback(
    async (deleteType: 'msmts' | 'full') => {
      if (!censusToDelete || !currentSite?.schemaName) return;

      const targetCensusID = censusToDelete.dateRanges?.[0]?.censusID;
      if (!targetCensusID) {
        ailogger.error('Missing required context: censusID not found in census to delete');
        setDeleteError('Census ID not found. Please try again.');
        setOpenDeleteCensusModal(false);
        return;
      }

      setDeleteError(null);
      setIsDeletingCensus(true);
      setOpenDeleteCensusModal(false);
      const loadingMessage = deleteType === 'msmts' ? 'Deleting census measurements...' : 'Deleting census measurements and fixed data...';
      // destructive mutation — global overlay blocks UI for the duration of the API call
      setLoading(true, loadingMessage);

      try {
        const response = await fetch('/api/clearcensus', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ schema: currentSite.schemaName, censusID: targetCensusID, type: deleteType })
        });
        if (!response.ok) {
          const rejectionMessage = await readCensusDeleteRejectionMessage(response);
          if (rejectionMessage) {
            ailogger.warn(`Census delete refused by the server (HTTP ${response.status}): ${rejectionMessage}`);
            setDeleteError(rejectionMessage);
            if (CENSUS_DELETE_STALE_LIST_STATUSES.includes(response.status)) {
              try {
                await refreshCensusList();
              } catch (refreshError) {
                ailogger.warn(`Census list refresh after a refused delete failed: ${refreshError instanceof Error ? refreshError.message : refreshError}`);
              }
            }
            return;
          }
          throw new Error(`Failed to clear census: ${response.status}`);
        }
        setCensusToDelete(null);
        refetchCensusSummary();
        // The deletion has already committed; a refresh failure must not be
        // reported as a failed delete (retrying the delete would 404).
        try {
          await refreshCensusList();
        } catch (refreshError) {
          ailogger.error('Census deleted but census list refresh failed', refreshError instanceof Error ? refreshError : undefined);
          setDeleteError('Census deleted, but refreshing the census list failed. Reload the page to see the updated list.');
        }
      } catch (error) {
        ailogger.error('Failed to delete census', error instanceof Error ? error : undefined);
        setDeleteError(CENSUS_DELETE_GENERIC_FAILURE_MESSAGE);
      } finally {
        setLoading(false);
        setIsDeletingCensus(false);
      }
    },
    [censusToDelete, currentSite?.schemaName, refreshCensusList, setLoading, refetchCensusSummary]
  );

  const deleteErrorAlert = deleteError && (
    <Alert color="danger" variant="soft" data-testid="census-overview-delete-error">
      {deleteError}
    </Alert>
  );

  if (!currentSite || !currentPlot || !currentCensus) {
    return (
      <Box sx={{ p: 3 }}>
        {deleteErrorAlert}
        <Typography level="h4" color="neutral">
          Please select a site, plot, and census to view the census overview.
        </Typography>
      </Box>
    );
  }

  const startDate = currentCensus.dateRanges?.[0]?.startDate;
  const endDate = currentCensus.dateRanges?.[0]?.endDate;
  const censusID = currentCensus.dateRanges?.[0]?.censusID;
  const userStatus = session?.user?.userStatus;
  const canReload = userStatus === 'global' || userStatus === 'db admin';
  const censusDeleteBlockReason = getCensusDeleteBlockReason(currentCensus, censusListContext, userStatus);
  const summary = censusSummary.summary;
  const hasSummaryScope = Boolean(censusID);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, width: '100%' }}>
      {deleteErrorAlert}

      <Stack component="header" direction="row" useFlexGap flexWrap="wrap" alignItems="flex-end" justifyContent="space-between" spacing={2}>
        <Box>
          <Typography level="body-sm" color="neutral" data-testid="census-overview-scope">
            {`${currentSite.siteName}${CENSUS_OVERVIEW_TEXT.scopeSeparator}${currentPlot.plotName}`}
          </Typography>
          <Typography level="h2" component="h1">
            {`${CENSUS_OVERVIEW_TEXT.censusTitlePrefix} ${currentCensus.plotCensusNumber}`}
          </Typography>
          <Typography level="body-sm" data-testid="census-overview-dates">
            {formatCensusDateRange(startDate, endDate)}
          </Typography>
        </Box>
        {currentSite.schemaName && currentPlot.plotID && censusID && (
          <Stack direction="row" spacing={1} alignItems="center">
            <PublishCensusButton
              schema={currentSite.schemaName}
              appPlotId={currentPlot.plotID}
              appCensusId={censusID}
              plotCensusNumber={currentCensus.plotCensusNumber ?? ''}
              canReload={canReload}
            />
            <CensusOverviewActionsMenu
              schema={currentSite.schemaName}
              deleteBlockReason={censusDeleteBlockReason}
              onDelete={() => handleCensusDelete(currentCensus)}
            />
          </Stack>
        )}
      </Stack>

      {summary && <PublishBlockerCallout blockers={summary.blockers} />}

      <CensusStatTiles
        countTrees={countTrees}
        countStems={countStems}
        stemTypes={stemTypes}
        isMetricsLoading={isLoading}
        quadrats={{ total: progressTacho.TotalQuadrats, populated: progressTacho.PopulatedQuadrats }}
        errorOverview={summary?.errorOverview ?? null}
        isErrorOverviewLoading={hasSummaryScope && censusSummary.isLoading}
      />

      {hasSummaryScope &&
        (censusSummary.errorMessage !== null ? (
          <Alert
            color="danger"
            variant="soft"
            data-testid="census-overview-summary-error"
            endDecorator={
              <Button size="sm" variant="solid" color="danger" onClick={censusSummary.refetch}>
                {CENSUS_OVERVIEW_TEXT.retry}
              </Button>
            }
          >
            {censusSummary.errorMessage}
          </Alert>
        ) : (
          <CensusSummaryPanels summary={summary} />
        ))}

      <DataQualityCard
        schema={currentSite.schemaName}
        plotID={currentPlot.plotID}
        censusID={censusID}
        isLoading={isLoading}
        onRefresh={async () => {
          if (currentSite?.schemaName && currentPlot?.plotID && currentCensus?.dateRanges?.[0]?.censusID) {
            const response = await fetch(`/api/refreshviews/measurementssummary/${currentSite.schemaName}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                plotID: currentPlot.plotID,
                censusID: currentCensus.dateRanges[0].censusID,
                runPostValidation: true
              })
            });
            if (!response.ok) {
              throw new Error(`Failed to refresh validations (HTTP ${response.status})`);
            }
            // The refresh rebuilt measurementssummary. This refetch is bound to the scope this
            // render saw; if the census changed meanwhile it is a no-op (the new scope fetched itself).
            censusSummary.refetch();
          }
        }}
      />

      <CensusDeletionModal
        open={openDeleteCensusModal}
        onClose={() => {
          setOpenDeleteCensusModal(false);
          setCensusToDelete(null);
        }}
        onDelete={handleConfirmDeleteCensus}
        census={censusToDelete}
        isDeleting={isDeletingCensus}
      />
    </Box>
  );
}
