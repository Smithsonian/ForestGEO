'use client';

import React, { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Button, CircularProgress, Stack, Typography } from '@mui/joy';
import { ReviewStates, type RevisionApplyOutcomeCounts, type UploadOutcome } from '@/config/macros/uploadsystemmacros';
import { FileRow } from '@/config/macros/formdetails';
import { useBackgroundValidation } from '@/app/hooks/usebackgroundvalidation';
import { useOrgCensusContext, usePlotContext } from '@/app/contexts/compat-hooks';
import { invalidateAfter } from '@/lib/query';
import { BulkEditPlan } from '@/config/editplan/types';
import RevisionApplyCounts from './revisionapplycounts';
import {
  RevisionApplyMatchedRow,
  RevisionApplyNewRow,
  RevisionApplyResponse,
  RevisionDuplicateToDelete,
  RevisionInvalidRow
} from '@/config/revisionuploadtypes';

const TRANSITION_DELAY_MS = 2000;

interface UploadRevisionApplyProps {
  matchedRows: RevisionApplyMatchedRow[];
  newRows: RevisionApplyNewRow[];
  invalidRows: RevisionInvalidRow[];
  confirmNewRows: boolean;
  schema: string;
  bulkPlanHash: string;
  /** Minted by the match endpoint (UUID v4); echoed back unchanged. See shared/invalidrowintegrity.ts. */
  uploadAttemptID: string;
  /** Authenticated HMAC the match endpoint computed over invalidRows; echoed back unchanged. See shared/invalidrowintegrity.ts. */
  invalidRowsIntegrityHash: string;
  setReviewState: (state: ReviewStates) => void;
  setIsDataUnsaved: (unsaved: boolean) => void;
  setUploadOutcome: Dispatch<SetStateAction<UploadOutcome | undefined>>;
  /**
   * Fired on a 409 plan-hash mismatch. freshInvalidRows/freshInvalidRowsIntegrityHash
   * are the apply route's AUTHORITATIVE replacement for the whole invalidRows
   * set — adopt both verbatim, never merge with the stale submitted set.
   */
  onPlanConflict: (freshPlan: BulkEditPlan, freshInvalidRows: RevisionInvalidRow[], freshInvalidRowsIntegrityHash: string) => void;
}

type ApplyStatus = 'applying' | 'success' | 'error';
const UPDATABLE_REVISION_FIELDS = ['dbh', 'hom', 'date', 'codes', 'comments'] as const;

function buildDuplicateDeletionHints(matchedRows: RevisionApplyMatchedRow[]): RevisionDuplicateToDelete[] {
  const seenPairs = new Set<string>();
  const duplicates: RevisionDuplicateToDelete[] = [];

  for (const row of matchedRows) {
    for (const duplicateMeasurementID of row.duplicateMeasurementIDsToDelete ?? []) {
      const pairKey = `${duplicateMeasurementID}:${row.coreMeasurementID}`;
      if (seenPairs.has(pairKey)) {
        continue;
      }

      seenPairs.add(pairKey);
      duplicates.push({
        coreMeasurementID: duplicateMeasurementID,
        survivorCoreMeasurementID: row.coreMeasurementID
      });
    }
  }

  return duplicates;
}

function hasRevisionFieldValues(csvRow: FileRow): boolean {
  return UPDATABLE_REVISION_FIELDS.some(field => {
    const value = csvRow[field];
    return value !== null && value !== undefined && String(value).trim() !== '';
  });
}

function hasDuplicateCleanupOnlyMatchedRows(matchedRows: RevisionApplyMatchedRow[]): boolean {
  return matchedRows.some(row => (row.duplicateMeasurementIDsToDelete?.length ?? 0) > 0 && !hasRevisionFieldValues(row.csvRow));
}

function toRevisionApplyOutcomeCounts(result: RevisionApplyResponse, hasDuplicateCleanupOnlyRows: boolean): RevisionApplyOutcomeCounts {
  return {
    updatedCount: result.updatedCount,
    deletedDuplicateCount: result.deletedDuplicateCount,
    insertedCount: result.insertedCount,
    // Older servers omit failedRowCount; absent means none were recorded.
    failedRowCount: result.failedRowCount ?? 0,
    skippedCount: result.skippedCount,
    applyErrorCount: result.applyErrors.length,
    hasDuplicateCleanupOnlyRows
  };
}

export default function UploadRevisionApply(props: Readonly<UploadRevisionApplyProps>) {
  const {
    matchedRows,
    newRows,
    invalidRows,
    confirmNewRows,
    schema,
    bulkPlanHash,
    uploadAttemptID,
    invalidRowsIntegrityHash,
    setReviewState,
    setIsDataUnsaved,
    setUploadOutcome,
    onPlanConflict
  } = props;

  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const { startValidation } = useBackgroundValidation();
  const plotID = currentPlot?.plotID;
  const censusID = currentCensus?.dateRanges?.[0]?.censusID;

  const [applyStatus, setApplyStatus] = useState<ApplyStatus>('applying');
  const [applyResult, setApplyResult] = useState<RevisionApplyResponse | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applyAttempt, setApplyAttempt] = useState(0);
  const startedAttemptsRef = useRef<Set<number>>(new Set());
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasDuplicateCleanupOnlyRows = hasDuplicateCleanupOnlyMatchedRows(matchedRows);
  const requestPayloadRef = useRef({
    matchedRows,
    newRows,
    invalidRows,
    confirmNewRows
  });

  requestPayloadRef.current = {
    matchedRows,
    newRows,
    invalidRows,
    confirmNewRows
  };

  useEffect(() => {
    return () => {
      if (transitionTimeoutRef.current !== null) {
        clearTimeout(transitionTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (applyStatus !== 'applying') {
      return;
    }

    if (startedAttemptsRef.current.has(applyAttempt)) {
      return;
    }

    startedAttemptsRef.current.add(applyAttempt);

    const currentRequestPayload = requestPayloadRef.current;
    const duplicateMeasurementIDsToDelete = buildDuplicateDeletionHints(currentRequestPayload.matchedRows);

    async function runApply() {
      try {
        setUploadOutcome(undefined);
        const response = await fetch('/api/revisionupload/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            matchedRows: currentRequestPayload.matchedRows,
            newRows: currentRequestPayload.newRows,
            invalidRows: currentRequestPayload.invalidRows,
            confirmNewRows: currentRequestPayload.confirmNewRows,
            duplicateMeasurementIDsToDelete,
            schema,
            plotID,
            censusID,
            bulkPlanHash,
            uploadAttemptID,
            invalidRowsIntegrityHash
          })
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
          if (
            response.status === 409 &&
            errorBody.freshPlan &&
            Array.isArray(errorBody.freshInvalidRows) &&
            typeof errorBody.freshInvalidRowsIntegrityHash === 'string'
          ) {
            onPlanConflict(errorBody.freshPlan as BulkEditPlan, errorBody.freshInvalidRows as RevisionInvalidRow[], errorBody.freshInvalidRowsIntegrityHash);
            setReviewState(ReviewStates.REVISION_MATCH);
            return;
          }
          throw new Error(errorBody.error || `Apply failed with status ${response.status}`);
        }

        const result: RevisionApplyResponse = await response.json();
        setApplyResult(result);
        setUploadOutcome({ kind: 'revisions', ...toRevisionApplyOutcomeCounts(result, hasDuplicateCleanupOnlyMatchedRows(currentRequestPayload.matchedRows)) });
        setApplyStatus('success');
        setIsDataUnsaved(false);

        await invalidateAfter('save-edit-plan', { siteSchema: schema, plotID, censusID });

        if (result.validationPending && schema && plotID && censusID) {
          startValidation({ schema, plotID, censusID });
        }

        if (transitionTimeoutRef.current !== null) {
          clearTimeout(transitionTimeoutRef.current);
        }
        transitionTimeoutRef.current = setTimeout(() => {
          setReviewState(ReviewStates.UPLOAD_AZURE);
          transitionTimeoutRef.current = null;
        }, TRANSITION_DELAY_MS);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        setApplyError(errorMessage);
        setApplyStatus('error');
      }
    }

    void runApply();
  }, [
    applyAttempt,
    applyStatus,
    bulkPlanHash,
    censusID,
    invalidRowsIntegrityHash,
    onPlanConflict,
    plotID,
    schema,
    setIsDataUnsaved,
    setReviewState,
    setUploadOutcome,
    startValidation,
    uploadAttemptID
  ]);

  function retryApply() {
    setApplyResult(null);
    setApplyError(null);
    setApplyStatus('applying');
    setApplyAttempt(prev => prev + 1);
  }

  if (applyStatus === 'applying') {
    return (
      <Stack spacing={3} alignItems="center" sx={{ p: 6 }}>
        <CircularProgress size="lg" />
        <Typography level="body-lg">Applying revisions...</Typography>
      </Stack>
    );
  }

  if (applyStatus === 'error') {
    return (
      <Stack spacing={3} sx={{ p: 4 }}>
        <Typography level="h3" color="danger">
          Failed to Apply Revisions
        </Typography>
        <Typography level="body-md" color="danger">
          {applyError}
        </Typography>
        <Stack direction="row" spacing={2} justifyContent="flex-end">
          <Button variant="outlined" color="neutral" onClick={() => setReviewState(ReviewStates.REVISION_MATCH)}>
            Back to Review
          </Button>
          <Button variant="solid" color="primary" onClick={retryApply}>
            Retry Apply
          </Button>
        </Stack>
      </Stack>
    );
  }

  return (
    <Stack spacing={3} sx={{ p: 4 }}>
      <Typography level="h3" color="success">
        Revisions Applied
      </Typography>

      {applyResult && <RevisionApplyCounts {...toRevisionApplyOutcomeCounts(applyResult, hasDuplicateCleanupOnlyRows)} />}

      <Typography level="body-sm" color="neutral">
        Running validations...
      </Typography>
    </Stack>
  );
}
