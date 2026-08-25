'use client';

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Modal,
  ModalClose,
  ModalDialog,
  Sheet,
  Stack,
  Typography
} from '@mui/joy';
import IsolatedFailedMeasurementsDataGrid from '@/components/datagrids/applications/isolated/isolatedfailedmeasurementsdatagrid';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useIsMounted } from '@/app/hooks/useismounted';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/compat-hooks';
import ailogger from '@/ailogger';
import { invalidateAfter } from '@/lib/query';

interface FailedMeasurementsModalProps {
  open: boolean;
  handleCloseModal: (options?: { dataChanged?: boolean }) => Promise<void>;
  autoCloseWhenEmpty?: boolean;
}

export default function FailedMeasurementsModal(props: FailedMeasurementsModalProps) {
  const { open, handleCloseModal, autoCloseWhenEmpty = true } = props;
  const [isReingesting, setIsReingesting] = useState(false);
  const [isClearingFailed, setIsClearingFailed] = useState(false);
  const [isClearingTemp, setIsClearingTemp] = useState(false);
  const [confirmClearFailed, setConfirmClearFailed] = useState(false);
  const [confirmClearTemp, setConfirmClearTemp] = useState(false);
  const [countError, setCountError] = useState<string | null>(null);
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const currentSite = useSiteContext();
  const { data: session } = useSession();
  const canRecoverRecords = Boolean(session?.user?.userStatus && session.user.userStatus !== 'pending');
  const canClearRecords = session?.user?.userStatus === 'global' || session?.user?.userStatus === 'db admin';
  const countsAbortControllerRef = useRef<AbortController | null>(null);
  const wasOpenRef = useRef(false);
  const hasDataChangesRef = useRef(false);
  const countScope =
    currentSite?.schemaName && currentPlot?.plotID && currentCensus?.dateRanges?.[0]?.censusID
      ? `${currentSite.schemaName}/${currentPlot.plotID}/${currentCensus.dateRanges[0].censusID}`
      : '';
  const [recordCounts, setRecordCounts] = useState<{ scope: string; failed: number | null; temporary: number | null }>({
    scope: '',
    failed: null,
    temporary: null
  });
  const failedCount = recordCounts.scope === countScope ? recordCounts.failed : null;
  const tempCount = recordCounts.scope === countScope ? recordCounts.temporary : null;

  // Track mount state to prevent state updates after unmount
  const { isMountedRef } = useIsMounted();

  const fetchRecordCounts = useCallback(async () => {
    countsAbortControllerRef.current?.abort();

    if (!currentSite?.schemaName || !currentPlot?.plotID || !currentCensus?.dateRanges?.[0]?.censusID) {
      setRecordCounts({ scope: '', failed: null, temporary: null });
      setCountError(null);
      return false;
    }

    const controller = new AbortController();
    countsAbortControllerRef.current = controller;
    const scope = `${currentSite.schemaName}/${currentPlot.plotID}/${currentCensus.dateRanges[0].censusID}`;

    try {
      const failedCountRequest = fetch(
        `/api/failedmeasurements/count/${encodeURIComponent(currentSite.schemaName)}/${currentPlot.plotID}/${currentCensus.dateRanges[0].censusID}`,
        {
          method: 'GET',
          signal: controller.signal
        }
      );
      const tempCountRequest = canClearRecords
        ? fetch(
            `/api/admin/clear/temporarymeasurements/${encodeURIComponent(currentSite.schemaName)}/${currentPlot.plotID}/${currentCensus.dateRanges[0].censusID}`,
            { method: 'GET', signal: controller.signal }
          )
        : Promise.resolve(null);
      const [failedResponse, tempResponse] = await Promise.all([failedCountRequest, tempCountRequest]);

      if (!failedResponse.ok) {
        throw new Error(`Failed-measurement count request returned ${failedResponse.status}`);
      }
      if (tempResponse && !tempResponse.ok) {
        throw new Error(`Temporary-measurement count request returned ${tempResponse.status}`);
      }

      const failedData = await failedResponse.json();
      const parsedFailedCount = failedData.recordCount;
      if (typeof parsedFailedCount !== 'number' || !Number.isSafeInteger(parsedFailedCount) || parsedFailedCount < 0) {
        throw new Error('Failed-measurement count response was invalid');
      }

      let parsedTempCount: number | null = null;
      if (tempResponse) {
        const tempData = await tempResponse.json();
        parsedTempCount = tempData.recordCount;
        if (typeof parsedTempCount !== 'number' || !Number.isSafeInteger(parsedTempCount) || parsedTempCount < 0) {
          throw new Error('Temporary-measurement count response was invalid');
        }
      }

      if (isMountedRef.current && !controller.signal.aborted && countsAbortControllerRef.current === controller) {
        setRecordCounts({ scope, failed: parsedFailedCount, temporary: parsedTempCount });
        setCountError(null);
      }
      return true;
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') return false;
      const err = error instanceof Error ? error : new Error(String(error));
      ailogger.error(`Failed to fetch failed-measurement modal counts for ${scope}:`, err);
      if (isMountedRef.current && !controller.signal.aborted && countsAbortControllerRef.current === controller) {
        setCountError('Unable to load record counts. Recovery remains available.');
      }
      return false;
    } finally {
      if (countsAbortControllerRef.current === controller) {
        countsAbortControllerRef.current = null;
      }
    }
  }, [canClearRecords, currentSite?.schemaName, currentPlot?.plotID, currentCensus?.dateRanges?.[0]?.censusID, isMountedRef]);

  const handleClearFailedMeasurements = async () => {
    if (!currentSite?.schemaName || !currentPlot?.plotID || !currentCensus?.dateRanges?.[0]?.censusID) {
      ailogger.error('Missing required context for clearing failed measurements');
      return;
    }

    setIsClearingFailed(true);
    try {
      const response = await fetch(
        `/api/admin/clear/failedmeasurements/${currentSite.schemaName}/${currentPlot.plotID}/${currentCensus.dateRanges?.[0].censusID}`,
        { method: 'DELETE' }
      );

      if (!response.ok) {
        throw new Error(`Failed to clear failed measurements: ${response.status}`);
      }

      const result = await response.json();
      ailogger.info('Failed measurements cleared:', result);

      setConfirmClearFailed(false);

      // Refresh counts
      await fetchRecordCounts();

      // Close modal if no records remaining
      if (result.recordsCleared > 0) {
        await handleCloseModal({ dataChanged: true });
      }
    } catch (error: any) {
      ailogger.error('Failed to clear failed measurements:', error);
    } finally {
      setIsClearingFailed(false);
    }
  };

  const handleClearTempMeasurements = async () => {
    if (!currentSite?.schemaName || !currentPlot?.plotID || !currentCensus?.dateRanges?.[0]?.censusID) {
      ailogger.error('Missing required context for clearing temporary measurements');
      return;
    }

    setIsClearingTemp(true);
    try {
      const response = await fetch(
        `/api/admin/clear/temporarymeasurements/${currentSite.schemaName}/${currentPlot.plotID}/${currentCensus.dateRanges?.[0].censusID}`,
        {
          method: 'DELETE'
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to clear temporary measurements: ${response.status}`);
      }

      const result = await response.json();
      ailogger.info('Temporary measurements cleared:', result);

      setConfirmClearTemp(false);

      // Refresh counts
      await fetchRecordCounts();
    } catch (error: any) {
      ailogger.error('Failed to clear temporary measurements:', error);
    } finally {
      setIsClearingTemp(false);
    }
  };

  const handleReingestAll = async () => {
    if (!currentSite?.schemaName || !currentPlot?.plotID || !currentCensus?.dateRanges?.[0]?.censusID) {
      ailogger.error('Missing required context for reingestion');
      return;
    }

    setIsReingesting(true);
    try {
      ailogger.info('Starting bulk reingestion');
      const response = await fetch(`/api/reingest/${currentSite.schemaName}/${currentPlot.plotID}/${currentCensus.dateRanges?.[0].censusID}`, {
        method: 'GET'
      });

      if (!response.ok) {
        throw new Error(`Failed to run reingestion: ${response.status}`);
      }

      const result = await response.json();
      ailogger.info('Reingestion result:', result);

      await invalidateAfter('reingest', {
        siteSchema: currentSite.schemaName,
        plotID: currentPlot.plotID,
        censusID: currentCensus.dateRanges?.[0].censusID
      });

      // Tell the parent synchronously that its summary view is now stale. A
      // parent state flag followed by close used to race React's next render.
      await handleCloseModal({ dataChanged: true });
    } catch (error: any) {
      ailogger.error('Failed to run reingestion:', error);
      // Don't close modal on error so user can see what happened
    } finally {
      setIsReingesting(false);
    }
  };

  // Fetch record counts when modal opens
  useEffect(() => {
    if (open && canRecoverRecords) {
      if (!wasOpenRef.current) {
        hasDataChangesRef.current = false;
      }
      wasOpenRef.current = true;
      void fetchRecordCounts();
    } else {
      wasOpenRef.current = false;
      countsAbortControllerRef.current?.abort();
      setRecordCounts({ scope: '', failed: null, temporary: null });
      setCountError(null);
    }
    return () => countsAbortControllerRef.current?.abort();
  }, [canRecoverRecords, open, fetchRecordCounts]);

  // Auto-close modal when all failed measurements have been resolved
  // Note: Only auto-close when failedCount has been explicitly loaded (not null)
  // and equals 0, to prevent premature closing during initial load
  useEffect(() => {
    if (autoCloseWhenEmpty && open && failedCount !== null && failedCount === 0 && !isReingesting && !isClearingFailed && !isClearingTemp) {
      ailogger.info('All failed measurements resolved - auto-closing modal');
      // Use void to explicitly ignore the promise - the async close is fire-and-forget
      void handleCloseModal({ dataChanged: hasDataChangesRef.current });
    }
  }, [autoCloseWhenEmpty, open, failedCount, isReingesting, isClearingFailed, isClearingTemp, handleCloseModal]);

  return (
    <Modal open={open} onClose={() => {}}>
      <ModalDialog
        size="lg"
        sx={{
          width: '95%',
          maxWidth: '1400px',
          maxHeight: '90vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
        role="alertdialog"
      >
        <ModalClose aria-label="Close failed measurements modal" onClick={() => void handleCloseModal({ dataChanged: hasDataChangesRef.current })} />
        <DialogTitle sx={{ pb: 1 }}>Failed Measurements</DialogTitle>
        <DialogContent sx={{ flex: 1, overflow: 'hidden', p: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Typography level="body-sm" sx={{ px: 3, py: 1, flexShrink: 0 }}>
            {canRecoverRecords
              ? 'The following measurements failed to be uploaded. You can edit individual measurements in this table or reingest all rows.'
              : 'Your account has read-only access and cannot recover failed measurements.'}
            {canRecoverRecords && canClearRecords ? ' Administrators can also permanently clear failed or temporary records.' : ''}
          </Typography>
          {countError && (
            <Alert color="warning" sx={{ mx: 3, mb: 1 }}>
              {countError} {canClearRecords ? 'Destructive actions are disabled until the counts reload.' : 'Refresh the page to try again.'}
            </Alert>
          )}
          {canRecoverRecords && (
            <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', px: 2, pb: 2 }}>
              <IsolatedFailedMeasurementsDataGrid
                onRowReingested={() => {
                  ailogger.info('Row successfully reingested - refreshing failed measurement count');
                  hasDataChangesRef.current = true;
                  void fetchRecordCounts();
                }}
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Stack spacing={2} sx={{ width: '100%' }}>
            {/* Confirmation dialogs */}
            {canClearRecords && confirmClearFailed && (
              <Sheet variant="soft" color="danger" sx={{ p: 2, borderRadius: 'sm' }}>
                <Stack spacing={1}>
                  <Typography level="title-sm" color="danger">
                    Confirm Clear Failed Measurements
                  </Typography>
                  <Typography level="body-sm">
                    This will permanently delete {failedCount || 0} failed measurement records. This action cannot be undone.
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                    <Button size="sm" variant="soft" onClick={() => setConfirmClearFailed(false)}>
                      Cancel
                    </Button>
                    <Button size="sm" variant="solid" color="danger" loading={isClearingFailed} onClick={handleClearFailedMeasurements}>
                      {isClearingFailed ? 'Clearing...' : 'Confirm Delete'}
                    </Button>
                  </Stack>
                </Stack>
              </Sheet>
            )}

            {canClearRecords && confirmClearTemp && (
              <Sheet variant="soft" color="warning" sx={{ p: 2, borderRadius: 'sm' }}>
                <Stack spacing={1}>
                  <Typography level="title-sm" color="warning">
                    Confirm Clear Temporary Measurements
                  </Typography>
                  <Typography level="body-sm">
                    This will delete {tempCount || 0} temporary measurement records. These are typically cleared automatically after processing.
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                    <Button size="sm" variant="soft" onClick={() => setConfirmClearTemp(false)}>
                      Cancel
                    </Button>
                    <Button size="sm" variant="solid" color="warning" loading={isClearingTemp} onClick={handleClearTempMeasurements}>
                      {isClearingTemp ? 'Clearing...' : 'Confirm Clear'}
                    </Button>
                  </Stack>
                </Stack>
              </Sheet>
            )}

            <Stack direction="row" spacing={2} sx={{ justifyContent: canClearRecords ? 'space-between' : 'flex-end', alignItems: 'center' }}>
              {/* Reset Controls */}
              {canClearRecords && (
                <>
                  <Stack direction="row" spacing={1}>
                    <Button
                      variant="soft"
                      color="danger"
                      size="sm"
                      disabled={isReingesting || isClearingFailed || isClearingTemp || failedCount === null || failedCount === 0}
                      onClick={() => {
                        fetchRecordCounts().then(loaded => {
                          if (loaded && isMountedRef.current) {
                            setConfirmClearFailed(true);
                          }
                        });
                      }}
                    >
                      Clear Failed ({failedCount ?? '?'})
                    </Button>
                    <Button
                      variant="soft"
                      color="warning"
                      size="sm"
                      disabled={isReingesting || isClearingFailed || isClearingTemp || tempCount === null || tempCount === 0}
                      onClick={() => {
                        fetchRecordCounts().then(loaded => {
                          if (loaded && isMountedRef.current) {
                            setConfirmClearTemp(true);
                          }
                        });
                      }}
                    >
                      Clear Temp ({tempCount ?? '?'})
                    </Button>
                  </Stack>

                  <Divider orientation="vertical" />
                </>
              )}

              {/* Main Actions */}
              <Stack direction="row" spacing={2}>
                {canRecoverRecords && (
                  <Button
                    variant="solid"
                    color="primary"
                    loading={isReingesting}
                    loadingPosition="start"
                    startDecorator={isReingesting ? <CircularProgress size="sm" /> : null}
                    onClick={handleReingestAll}
                    disabled={isReingesting || isClearingFailed || isClearingTemp || failedCount === 0}
                    sx={{ minWidth: 160 }}
                  >
                    {isReingesting ? 'Reingesting...' : 'Reingest All Rows'}
                  </Button>
                )}
                <Button
                  variant="soft"
                  color="neutral"
                  onClick={() => void handleCloseModal({ dataChanged: hasDataChangesRef.current })}
                  disabled={isReingesting || isClearingFailed || isClearingTemp}
                  sx={{ minWidth: 100 }}
                >
                  Close
                </Button>
              </Stack>
            </Stack>
          </Stack>
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
}
