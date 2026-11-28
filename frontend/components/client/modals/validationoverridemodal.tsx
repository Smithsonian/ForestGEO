'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/compat-hooks';
import { Alert, Button, DialogActions, DialogContent, DialogTitle, Modal, ModalClose, ModalDialog, Typography } from '@mui/joy';
import ConfirmationDialog from '@/components/client/modals/confirmationdialog';
import CircularProgress from '@mui/joy/CircularProgress';
import ailogger from '@/ailogger';
import { describeValidationScopeActionProblem, requestValidationOverride } from '@/lib/validations/request-validation-scope-action';
import { VALIDATION_OVERRIDE_FAILED_MESSAGE } from '@/config/validationscopeactions';

interface VOMProps {
  isValidationOverrideModalOpen: boolean;
  handleValidationOverrideModalClose: (overridePerformed: boolean) => Promise<void>;
}

export const NO_ELIGIBLE_ROWS_MESSAGE =
  'No measurements are eligible for override. Ingestion failures (rows without a linked stem) and rows that already passed are never overridden.';

export class ValidationOverrideRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationOverrideRequestError';
  }
}

/**
 * Asks the server to override validation for every eligible measurement of the census. The server applies the
 * eligibility predicate, the busy check and all writes in one transaction (POST /api/validations/override), so
 * either every eligible row is overridden or nothing is. Resolves to the number of rows overridden; 0 means
 * nothing was eligible. Rejects with a message fit to show when nothing changed or the outcome is unknown.
 */
export async function performValidationOverride(schema: string, plotID: number, censusID: number): Promise<number> {
  const outcome = await requestValidationOverride({ schema, plotID, censusID });
  if (outcome.status === 'done') return outcome.result.overriddenMeasurementCount;
  throw new ValidationOverrideRequestError(describeValidationScopeActionProblem(outcome, VALIDATION_OVERRIDE_FAILED_MESSAGE));
}

export default function ValidationOverrideModal(props: VOMProps) {
  const { isValidationOverrideModalOpen, handleValidationOverrideModalClose } = props;
  const [openConfirmOverrideModal, setOpenConfirmOverrideModal] = useState(true); // starting with confirmation
  const [isOverrideConfirmed, setIsOverrideConfirmed] = useState(false); // need confirmation for override
  const [isRunning, setIsRunning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noopMessage, setNoopMessage] = useState<string | null>(null);
  const hasStartedRef = useRef(false);
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();

  const triggerOverride = useCallback(async () => {
    const schema = currentSite?.schemaName;
    const plotID = currentPlot?.plotID;
    const censusID = currentCensus?.dateRanges?.[0]?.censusID;
    if (!schema || plotID === undefined || plotID === null || censusID === undefined || censusID === null) {
      throw new Error('Active site, plot, or census selection is missing.');
    }
    return performValidationOverride(schema, plotID, censusID);
  }, [currentSite?.schemaName, currentPlot?.plotID, currentCensus?.dateRanges]);

  useEffect(() => {
    if (!isOverrideConfirmed || hasStartedRef.current) return;
    hasStartedRef.current = true;
    setIsRunning(true);
    triggerOverride()
      .then(async validatedCount => {
        setIsRunning(false);
        if (validatedCount === 0) {
          setNoopMessage(NO_ELIGIBLE_ROWS_MESSAGE);
          return;
        }
        await handleValidationOverrideModalClose(true);
      })
      .catch((error: unknown) => {
        const err = error instanceof Error ? error : new Error(String(error));
        ailogger.error('Override operation failed:', err);
        setIsRunning(false);
        setErrorMessage(err.message);
      });
  }, [isOverrideConfirmed, triggerOverride, handleValidationOverrideModalClose]);

  const showResult = errorMessage !== null || noopMessage !== null;

  return (
    <Modal
      open={isValidationOverrideModalOpen}
      onClose={() => handleValidationOverrideModalClose(false)}
      sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}
    >
      <ModalDialog role={'alertdialog'}>
        <ModalClose />
        <DialogTitle>Override All Validation Results?</DialogTitle>
        <DialogContent>
          {openConfirmOverrideModal && !isOverrideConfirmed && (
            <ConfirmationDialog
              open={openConfirmOverrideModal}
              onClose={() => {
                setOpenConfirmOverrideModal(false);
                handleValidationOverrideModalClose(false);
              }}
              onConfirm={() => {
                setOpenConfirmOverrideModal(false);
                setIsOverrideConfirmed(true);
              }}
              title={'WARNING: Confirm Validation Override?'}
              content={
                'Are you sure you want to override the validation status of all eligible measurements in this census? Ingestion failures (rows without a linked stem) are not overridden.'
              }
            />
          )}
          {isRunning && <CircularProgress />}
          {errorMessage && (
            <Alert color="danger" role="alert">
              {errorMessage}
            </Alert>
          )}
          {noopMessage && <Typography level="body-md">{noopMessage}</Typography>}
        </DialogContent>
        {showResult && (
          <DialogActions>
            <Button variant="solid" color="neutral" onClick={() => handleValidationOverrideModalClose(false)}>
              Close
            </Button>
          </DialogActions>
        )}
      </ModalDialog>
    </Modal>
  );
}
