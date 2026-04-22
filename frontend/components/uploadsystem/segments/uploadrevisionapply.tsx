'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, CircularProgress, Stack, Typography } from '@mui/joy';
import { ReviewStates } from '@/config/macros/uploadsystemmacros';
import { FileRow } from '@/config/macros/formdetails';
import { useBackgroundValidation } from '@/app/hooks/usebackgroundvalidation';
import { useOrgCensusContext, usePlotContext } from '@/app/contexts/compat-hooks';
import { BulkEditPlan } from '@/config/editplan/types';
import { RevisionApplyMatchedRow, RevisionApplyNewRow, RevisionApplyResponse, RevisionDuplicateToDelete, RevisionInvalidRow } from '@/config/revisionuploadtypes';

const TRANSITION_DELAY_MS = 2000;

interface UploadRevisionApplyProps {
  matchedRows: RevisionApplyMatchedRow[];
  newRows: RevisionApplyNewRow[];
  invalidRows: RevisionInvalidRow[];
  confirmNewRows: boolean;
  schema: string;
  bulkPlanHash: string;
  setReviewState: (state: ReviewStates) => void;
  setIsDataUnsaved: (unsaved: boolean) => void;
  onPlanConflict: (freshPlan: BulkEditPlan) => void;
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

export default function UploadRevisionApply(props: Readonly<UploadRevisionApplyProps>) {
  const { matchedRows, newRows, invalidRows, confirmNewRows, schema, bulkPlanHash, setReviewState, setIsDataUnsaved, onPlanConflict } = props;

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
  const hasDuplicateCleanupOnlyRows = matchedRows.some(row => (row.duplicateMeasurementIDsToDelete?.length ?? 0) > 0 && !hasRevisionFieldValues(row.csvRow));
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
            bulkPlanHash
          })
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
          if (response.status === 409 && errorBody.freshPlan) {
            onPlanConflict(errorBody.freshPlan as BulkEditPlan);
            setReviewState(ReviewStates.REVISION_MATCH);
            return;
          }
          throw new Error(errorBody.error || `Apply failed with status ${response.status}`);
        }

        const result: RevisionApplyResponse = await response.json();
        setApplyResult(result);
        setApplyStatus('success');
        setIsDataUnsaved(false);

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
  }, [applyAttempt, applyStatus, bulkPlanHash, censusID, onPlanConflict, plotID, schema, setIsDataUnsaved, setReviewState, startValidation]);

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

      {applyResult && (
        <Box>
          <Typography level="body-md">{applyResult.updatedCount} measurement(s) updated</Typography>
          {applyResult.deletedDuplicateCount > 0 && <Typography level="body-md">{applyResult.deletedDuplicateCount} duplicate(s) deleted</Typography>}
          {applyResult.insertedCount > 0 && <Typography level="body-md">{applyResult.insertedCount} new measurement(s) inserted</Typography>}
          {applyResult.skippedCount > 0 && (
            <Typography level="body-md" color="neutral">
              {applyResult.skippedCount} matched row(s) required no field updates
            </Typography>
          )}
          {applyResult.deletedDuplicateCount > 0 && hasDuplicateCleanupOnlyRows && (
            <Typography level="body-sm" color="neutral">
              Duplicate cleanup can still use a matched survivor row even when its field values were unchanged.
            </Typography>
          )}
          {applyResult.applyErrors.length > 0 && (
            <Typography level="body-md" color="warning">
              {applyResult.applyErrors.length} row(s) had errors and were skipped
            </Typography>
          )}
        </Box>
      )}

      <Typography level="body-sm" color="neutral">
        Running validations...
      </Typography>
    </Stack>
  );
}
