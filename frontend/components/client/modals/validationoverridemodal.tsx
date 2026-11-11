'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/compat-hooks';
import { Alert, Button, DialogActions, DialogContent, DialogTitle, Modal, ModalClose, ModalDialog, Typography } from '@mui/joy';
import ConfirmationDialog from '@/components/client/modals/confirmationdialog';
import CircularProgress from '@mui/joy/CircularProgress';
import ailogger from '@/ailogger';
import { buildValidationOverrideStatements, type ValidationOverrideStatement } from '@/config/measurementstatefilters';

interface VOMProps {
  isValidationOverrideModalOpen: boolean;
  handleValidationOverrideModalClose: (overridePerformed: boolean) => Promise<void>;
}

export const NO_ELIGIBLE_ROWS_MESSAGE =
  'No measurements are eligible for override. Ingestion failures (rows without a linked stem) and rows that already passed are never overridden.';

async function runStatement(statement: ValidationOverrideStatement, description: string): Promise<any> {
  const response = await fetch(`/api/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: statement.query, params: statement.params })
  });
  if (!response.ok) {
    let details = '';
    try {
      const body = await response.json();
      details = body?.error ?? body?.details ?? '';
    } catch {
      // body is not JSON; fall through with the status code only
    }
    throw new Error(`${description} failed (HTTP ${response.status})${details ? `: ${details}` : ''}`);
  }
  return response.json();
}

/**
 * Overrides validation for eligible measurements in one plot/census scope. Every statement is built
 * from the shared eligibility predicate (see buildMeasurementOverrideEligibleSql). Returns the number
 * of rows the final UPDATE actually validated (its affectedRows, which can differ from the pre-count
 * if eligibility changed in between); 0 means nothing was validated. A response without a numeric
 * affectedRows is an error, never a success.
 *
 * Atomicity: /api/query executes exactly one statement per request (multi-statement is rejected), so
 * the clear and update cannot share a transaction. They run clear-then-update: if the update fails
 * after the clear, rows keep IsValidated FALSE/NULL (still visible as failed/pending, still eligible)
 * and the operation is safely retryable. A row is never left validated with its logs half-cleared.
 */
export async function performValidationOverride(schema: string, plotID: number, plotCensusNumber: number): Promise<number> {
  const statements = buildValidationOverrideStatements(schema, plotID, plotCensusNumber);
  const countResult = await runStatement(statements.count, 'Counting eligible measurements');
  const eligibleCount = Number(Array.isArray(countResult) ? countResult[0]?.EligibleCount : 0) || 0;
  if (eligibleCount === 0) return 0;
  // Zero validation-log rows to delete is a normal outcome (pending rows have none); not an error.
  await runStatement(statements.clearValidationLogs, 'Clearing validation logs');
  const updateResult = await runStatement(statements.markValidated, 'Marking measurements validated');
  const affectedRows = updateResult?.affectedRows;
  if (typeof affectedRows !== 'number' || !Number.isFinite(affectedRows) || affectedRows < 0) {
    throw new Error('Marking measurements validated returned an unexpected response (no affectedRows); the result is unknown.');
  }
  return affectedRows;
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
    const plotCensusNumber = currentCensus?.plotCensusNumber;
    if (!schema || plotID === undefined || plotID === null || plotCensusNumber === undefined || plotCensusNumber === null) {
      throw new Error('Active site, plot, or census selection is missing.');
    }
    return performValidationOverride(schema, plotID, plotCensusNumber);
  }, [currentSite?.schemaName, currentPlot?.plotID, currentCensus?.plotCensusNumber]);

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
        setErrorMessage(`Validation override failed: ${err.message}`);
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
