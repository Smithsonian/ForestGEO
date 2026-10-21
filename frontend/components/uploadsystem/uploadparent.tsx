'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReviewStates } from '@/config/macros/uploadsystemmacros';
import { FileCollectionRowSet, FileRow, FormType, RequiredTableHeadersByFormType, SourceFormat } from '@/config/macros/formdetails';
import { FileWithPath } from 'react-dropzone';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/compat-hooks';
import { useSession } from 'next-auth/react';
import { Box, Button, CircularProgress, Stack, Typography } from '@mui/joy';
import ContextValidationGuard from '@/components/shared/ContextValidationGuard';
import UploadParseFiles from '@/components/uploadsystem/segments/uploadparsefiles';
import UploadAsyncJob from '@/components/uploadsystem/segments/uploadasyncjob';
import UploadFireSQL from '@/components/uploadsystem/segments/uploadfiresql';
import UploadError from '@/components/uploadsystem/segments/uploaderror';
import UploadValidation from '@/components/uploadsystem/segments/uploadvalidation';
import UploadValidationErrors from '@/components/uploadsystem/segments/uploadvalidationerrors';
import UploadUpdateValidations from '@/components/uploadsystem/segments/uploadupdatevalidations';
import UploadStart from '@/components/uploadsystem/segments/uploadstart';
import UploadFireAzure from '@/components/uploadsystem/segments/uploadfireazure';
import UploadComplete from '@/components/uploadsystem/segments/uploadcomplete';
import UploadReingestion from '@/components/uploadsystem/segments/uploadreingestion';
import UploadRevisionMatch from '@/components/uploadsystem/segments/uploadrevisionmatch';
import UploadRevisionApply from '@/components/uploadsystem/segments/uploadrevisionapply';
import UploadArcgisPreflight from '@/components/uploadsystem/segments/uploadarcgispreflight';
import MeasurementReplacementConfirmDialog from '@/components/uploadsystem/segments/measurementreplacementconfirmdialog';
import FailedMeasurementsModal from '@/components/client/modals/failedmeasurementsmodal';
import ailogger from '@/ailogger';
import { useFileManagement } from '@/app/hooks/usefilemanagement';
import { ColumnMapping } from '@/lib/column-mapping/types';
import { useUploadState } from '@/app/hooks/useuploadstate';
import { useErrorHandling } from '@/app/hooks/useerrorhandling';
import { ErrorBoundary } from '@/components/errorboundary';
import { UploadMode } from '@/config/uploadmodes';
import { canonicalizeRevisionRow, normalizeRevisionHeader } from '@/components/uploadsystemhelpers/revisionfileparse';
import { RevisionInvalidRow, RevisionMatchedRow, RevisionUploadResponse } from '@/config/revisionuploadtypes';
import { BulkEditPlan } from '@/config/editplan/types';
import type { ArcgisImportReference } from '@/lib/arcgis/types';
import type { QuadratOverlapAcknowledgment } from '@/lib/provisioning/types';
import type { QuadratOverlapSummary } from '@/lib/provisioning/quadrat-collection-validation';
import { useAsyncUploadFeature } from '@/app/hooks/useasyncuploadfeature';

// Revision matching can hang indefinitely on a stalled connection; this bounds how long
// the UI waits before treating the request as failed rather than leaving the user on the
// loading state forever.
const REVISION_MATCH_TIMEOUT_MS = 120_000;

// dataViewActive is 1-based: FileListEnhanced renders the tab at index dataViewActive - 1.
const FIRST_FILE_VIEW_INDEX = 1;

export interface CMIDRow {
  coreMeasurementID: number;
  fileName: string;
  row: FileRow;
}

export interface DetailedCMIDRow extends CMIDRow {
  plotName?: string;
  plotCensusNumber?: number;
  quadratName?: string;
  speciesName?: string;
}

/**
 * Reconciles a 409 plan-hash-mismatch response into the current match
 * result. `freshInvalidRows`/`freshInvalidRowsIntegrityHash` are the apply
 * route's AUTHORITATIVE replacement for the ENTIRE invalidRows set (see
 * apply/route.ts's RevisionApplyPlanHashMismatchError) — they are adopted
 * verbatim, never recomputed from `freshPlan.rowPlans` here. Reconstructing
 * an equivalent set from rowPlans would risk disagreeing with what the
 * server actually hashed/persisted, and `rowPlans[].rowIndex` is a position
 * into the survivor-only bulk input the apply route built, not the row's
 * source csvIndex — conflating the two would attribute a reason to the
 * wrong source row.
 */
export function mergeFreshRevisionPlan(
  result: RevisionUploadResponse,
  freshPlan: BulkEditPlan,
  freshInvalidRows: RevisionInvalidRow[],
  freshInvalidRowsIntegrityHash: string
): RevisionUploadResponse {
  const changesByTarget = new Map<number, Record<string, { from: unknown; to: unknown }>>();
  for (const rowPlan of freshPlan.rowPlans) {
    if (rowPlan.status === 'invalid' || rowPlan.targetID === undefined) continue;
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const change of rowPlan.plan?.fieldChanges ?? []) {
      changes[change.field] = { from: change.from, to: change.to };
    }
    changesByTarget.set(rowPlan.targetID, changes);
  }

  // A matched row whose csvIndex now appears in the server's authoritative
  // invalid set was demoted by this apply attempt and must drop out of
  // matchedRows — matched purely by csvIndex, never by array position.
  const freshInvalidCsvIndexes = new Set(freshInvalidRows.map(row => row.csvIndex));
  const matchedRows: RevisionMatchedRow[] = result.matchedRows
    .filter(row => !freshInvalidCsvIndexes.has(row.csvIndex))
    .map(row => ({
      ...row,
      changes: changesByTarget.get(row.coreMeasurementID) ?? row.changes
    }));

  const matchedWithChanges = matchedRows.filter(row => Object.keys(row.changes).length > 0 || (row.duplicateMeasurementIDsToDelete?.length ?? 0) > 0).length;

  return {
    ...result,
    matchedRows,
    invalidRows: freshInvalidRows,
    counts: {
      ...result.counts,
      matched: matchedRows.length,
      matchedWithChanges,
      invalid: freshInvalidRows.length,
      total: matchedRows.length + result.newRows.length + freshInvalidRows.length + (result.collapsedRows?.length ?? 0)
    },
    bulkPlan: freshPlan,
    invalidRowsIntegrityHash: freshInvalidRowsIntegrityHash
  };
}

interface UploadParentProps {
  onReset: () => void;
  overrideUploadForm?: FormType;
  overrideUploadMode?: UploadMode;
  overrideSourceFormat?: SourceFormat;
  skipToProcessing?: boolean;
  onUploadComplete?: () => void;
}

function UploadParentInner(props: UploadParentProps) {
  const { onReset, overrideUploadForm, overrideUploadMode, overrideSourceFormat, skipToProcessing, onUploadComplete } = props;

  // Custom hooks for state management
  const fileManagement = useFileManagement();
  const uploadState = useUploadState(overrideUploadForm, skipToProcessing, overrideUploadMode, overrideSourceFormat);
  const { setReviewState: setUploadReviewState } = uploadState;
  const errorHandling = useErrorHandling();

  // Remaining local state (not managed by custom hooks)
  const [parsedData, setParsedData] = useState<FileCollectionRowSet>({});
  const [allRowToCMID, setAllRowToCMID] = useState<DetailedCMIDRow[]>([]);
  const [selectedDelimiters, setSelectedDelimiters] = useState<Record<string, string>>({});
  // The uploader's confirmation that overlapping quadrat footprints reflect field measurements.
  // Held here (rather than inside UploadParseFiles) because it is confirmed in UploadParseFiles but
  // UploadFireSQL, in a later ReviewStates screen, must still see it when it sends the requests.
  // Quadrats form only.
  const [quadratOverlapAcknowledgment, setQuadratOverlapAcknowledgment] = useState<QuadratOverlapAcknowledgment | null>(null);
  const [serverQuadratOverlapSummaries, setServerQuadratOverlapSummaries] = useState<QuadratOverlapSummary[]>([]);
  const clearServerQuadratOverlapSummaries = useCallback(() => setServerQuadratOverlapSummaries([]), []);
  const handleQuadratOverlapAcknowledgmentRequired = useCallback(
    (summaries: QuadratOverlapSummary[]) => {
      setQuadratOverlapAcknowledgment(null);
      setServerQuadratOverlapSummaries(previous => {
        const bySignature = new Map(previous.map(summary => [summary.layoutSignature, summary]));
        summaries.forEach(summary => bySignature.set(summary.layoutSignature, summary));
        return [...bySignature.values()];
      });
      setUploadReviewState(ReviewStates.UPLOAD_FILES);
    },
    [setUploadReviewState]
  );
  const [showFailedMeasurementsModal, setShowFailedMeasurementsModal] = useState(false);
  const [isReingestionMode, setIsReingestionMode] = useState(false);
  const [revisionMatchResult, setRevisionMatchResult] = useState<RevisionUploadResponse | null>(null);
  const [revisionConfirmNewRows, setRevisionConfirmNewRows] = useState(false);
  // Pre-flight: when a non-admin user uploads a revisions CSV containing
  // taxonomic-identity columns (spcode), the apply phase will hit
  // revisionRolePolicy and block. Surface this at the parse step so the user
  // doesn't reach the match review only to fail at Apply.
  const [revisionRolePreflightWarning, setRevisionRolePreflightWarning] = useState<string | null>(null);
  const [arcgisImportSession, setArcgisImportSession] = useState<ArcgisImportReference | null>(null);
  const [columnMappings, setColumnMappings] = useState<Record<string, ColumnMapping>>({});
  const setColumnMappingForFile = useCallback((fileName: string, mapping: ColumnMapping) => {
    setColumnMappings(prev => ({ ...prev, [fileName]: mapping }));
  }, []);
  const dropColumnMapping = useCallback((fileName: string) => {
    setColumnMappings(prev => {
      if (!(fileName in prev)) return prev;
      const { [fileName]: _dropped, ...rest } = prev;
      return rest;
    });
  }, []);

  // Track if we've already initialized reingestion to prevent re-triggering
  const reingestionInitializedRef = useRef(false);

  // The in-flight /api/revisionupload request's controller, so the cancel button and
  // unmount cleanup can abort it explicitly rather than leaving it to resolve into a
  // component that no longer wants the result.
  const revisionMatchAbortControllerRef = useRef<AbortController | null>(null);

  // The uploadAttemptID the match route minted for the CURRENT upload, so a
  // re-match of this same attempt (not a new upload) can echo it back and
  // retain its identity -- see app/api/revisionupload/route.ts's
  // previousUploadAttemptID. Cleared everywhere a NEW attempt begins (every
  // call site that resets revisionMatchResult to null ahead of a fresh
  // parse/upload), so a genuinely new upload never inherits a prior identity.
  const currentUploadAttemptIDRef = useRef<string | null>(null);

  // Context and session
  const _currentPlot = usePlotContext();
  const _currentCensus = useOrgCensusContext();
  const currentSite = useSiteContext();
  const { data: session } = useSession();

  const currentPlotID = _currentPlot?.plotID ?? null;
  const currentCensusID = _currentCensus?.dateRanges?.[0]?.censusID ?? null;
  const asyncUploadEnabled = useAsyncUploadFeature({
    schema: currentSite?.schemaName,
    formType: uploadState.state.uploadForm
  });

  // Measurements Clean Re-Upload replacement confirmation (issue #504): a header-only
  // CSV previously reached this destructive path and silently deleted an existing
  // census, so before it proceeds we fetch how many rows the exact target scope has
  // and require a typed confirmation if any do. scopeKey covers every field that
  // changes which rows would be deleted; file identity is tracked separately by object
  // reference so a same-named File swap also invalidates an in-flight check.
  const cleanReplacementScopeKey = useMemo(
    () =>
      JSON.stringify({
        schema: currentSite?.schemaName ?? null,
        plotID: currentPlotID,
        censusID: currentCensusID,
        uploadMode: uploadState.state.uploadMode ?? null,
        uploadForm: uploadState.state.uploadForm ?? null,
        sourceFormat: uploadState.state.sourceFormat ?? null
      }),
    [currentSite?.schemaName, currentPlotID, currentCensusID, uploadState.state.uploadMode, uploadState.state.uploadForm, uploadState.state.sourceFormat]
  );
  const [replacementPreview, setReplacementPreview] = useState<{
    requestId: number;
    scopeKey: string;
    filesSnapshot: typeof fileManagement.files;
    status: 'checking' | 'needsConfirmation';
    existingRowCount?: number;
  } | null>(null);
  // Monotonically-increasing token: guards against a stale async response landing
  // after its scope changed, and doubles as a per-request id so the confirmation
  // dialog remounts (resetting typed text) even when existingRowCount repeats.
  const replacementCheckTokenRef = useRef(0);
  const pendingReplacementActionRef = useRef<(() => void) | null>(null);

  function invalidatePendingReplacementCheck() {
    replacementCheckTokenRef.current += 1;
    pendingReplacementActionRef.current = null;
  }

  function filesMatchSnapshot(snapshot: typeof fileManagement.files): boolean {
    const current = fileManagement.files;
    if (current.length !== snapshot.length) return false;
    return current.every((file, index) => file === snapshot[index]);
  }

  // Any change to scope OR to any selected File's identity invalidates an in-flight
  // check / shown confirmation, since it was computed for a target that no longer
  // exists. `fileManagement.files` is only a new array when add/remove/replaceFile
  // actually runs (see useFileManagement), so this also catches a same-named File swap.
  useEffect(() => {
    invalidatePendingReplacementCheck();
    setReplacementPreview(null);
  }, [cleanReplacementScopeKey, fileManagement.files]);

  // Unmount must invalidate too, so a response that resolves after this component is
  // gone can never invoke an action against a component that no longer exists.
  useEffect(() => {
    return () => {
      invalidatePendingReplacementCheck();
    };
  }, []);

  async function requestCleanMeasurementsReplacementConfirmation(onConfirmed: () => void) {
    const scopeKey = cleanReplacementScopeKey;
    const filesSnapshot = fileManagement.files;
    const token = ++replacementCheckTokenRef.current;
    pendingReplacementActionRef.current = null;
    setReplacementPreview({ requestId: token, scopeKey, filesSnapshot, status: 'checking' });

    try {
      if (!currentSite?.schemaName || !currentPlotID || !currentCensusID) {
        throw new Error('Site, plot, and census must all be selected before a Clean Re-Upload can proceed.');
      }

      const params = new URLSearchParams({
        schema: currentSite.schemaName,
        plotID: String(currentPlotID),
        censusID: String(currentCensusID)
      });
      const response = await fetch(`/api/uploads/replacement-preview?${params.toString()}`, { cache: 'no-store' });

      // A newer request has already superseded this one; let that one decide.
      if (replacementCheckTokenRef.current !== token) return;

      if (!response.ok) {
        throw new Error(`Failed to check existing measurements for this census (HTTP ${response.status}).`);
      }

      const payload = await response.json().catch(() => null);
      const existingRowCount = payload?.existingRowCount;
      // A fetch failure, non-200, or a count that isn't a safe nonnegative integer must
      // never be treated as "zero existing rows" -- that would reopen the hole this
      // confirmation exists to close.
      if (!Number.isSafeInteger(existingRowCount) || existingRowCount < 0) {
        throw new Error('Received an invalid existing measurement count from the server.');
      }

      if (replacementCheckTokenRef.current !== token) return;

      if (existingRowCount === 0) {
        setReplacementPreview(null);
        onConfirmed();
        return;
      }

      pendingReplacementActionRef.current = onConfirmed;
      setReplacementPreview({ requestId: token, scopeKey, filesSnapshot, status: 'needsConfirmation', existingRowCount });
    } catch (err: unknown) {
      if (replacementCheckTokenRef.current !== token) return;
      setReplacementPreview(null);
      pendingReplacementActionRef.current = null;
      const errorObj = err instanceof Error ? err : new Error(String(err));
      errorHandling.setError(errorObj);
      uploadState.setReviewState(ReviewStates.ERRORS);
    }
  }

  function handleReplacementConfirmed() {
    const action = pendingReplacementActionRef.current;
    const preview = replacementPreview;
    pendingReplacementActionRef.current = null;
    setReplacementPreview(null);

    // Defense in depth: re-verify scope/file-identity right before the destructive
    // action, even though the effect above already clears the dialog on change.
    if (!action || !preview) return;
    if (preview.scopeKey !== cleanReplacementScopeKey) return;
    if (!filesMatchSnapshot(preview.filesSnapshot)) return;

    action();
  }

  function handleReplacementCancelled() {
    pendingReplacementActionRef.current = null;
    setReplacementPreview(null);
  }

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (uploadState.state.isDataUnsaved) {
        event.preventDefault();
        event.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [uploadState.state.isDataUnsaved]);

  useEffect(() => {
    if (uploadState.state.reviewState === ReviewStates.COMPLETE) {
      // Reset reingestion flag when upload completes
      setIsReingestionMode(false);

      if (onUploadComplete) {
        onUploadComplete();
      }
    }
  }, [uploadState.state.reviewState, onUploadComplete]);

  // Handle invalid state: if no upload form is set but we're not at START, reset to start
  // This must be in useEffect, not during render, to avoid React error #185 (Maximum update depth exceeded)
  useEffect(() => {
    if (!uploadState.state.uploadForm && uploadState.state.reviewState !== ReviewStates.START) {
      // Reset to start state when in invalid state
      uploadState.resetToStart();
      fileManagement.clearFiles();
      setColumnMappings({});
      setParsedData({});
      setIsReingestionMode(false);
      setRevisionMatchResult(null);
      currentUploadAttemptIDRef.current = null;
      setRevisionConfirmNewRows(false);
      setArcgisImportSession(null);
      setQuadratOverlapAcknowledgment(null);
      setServerQuadratOverlapSummaries([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadState.state.uploadForm, uploadState.state.reviewState]);

  function _areHeadersValid(actualHeaders: string[]): {
    isValid: boolean;
    missingHeaders: string[];
  } {
    if (!uploadState.state.uploadForm) throw new Error('No upload form set!');
    const requiredHeaders = RequiredTableHeadersByFormType[uploadState.state.uploadForm];
    const requiredExpectedHeadersLower = requiredHeaders.map(header => header.label.toLowerCase());
    const actualHeadersLower = actualHeaders.map(header => header.toLowerCase());

    const missingHeaders = requiredExpectedHeadersLower.filter(expectedHeader => !actualHeadersLower.includes(expectedHeader));

    return {
      isValid: missingHeaders.length === 0,
      missingHeaders: missingHeaders.map(header => header.charAt(0).toUpperCase() + header.slice(1))
    };
  }

  async function handleReturnToStart() {
    uploadState.resetToStart();
    fileManagement.clearFiles();
    setColumnMappings({});
    setParsedData({});
    setIsReingestionMode(false);
    setRevisionMatchResult(null);
    currentUploadAttemptIDRef.current = null;
    setRevisionConfirmNewRows(false);
    setArcgisImportSession(null);
    setQuadratOverlapAcknowledgment(null);
    setServerQuadratOverlapSummaries([]);
  }

  async function resetError() {
    errorHandling.clearError();
  }

  // Function to handle file addition
  const handleAddFile = (newFile: FileWithPath) => {
    setArcgisImportSession(null);
    setQuadratOverlapAcknowledgment(null);
    setServerQuadratOverlapSummaries([]);
    fileManagement.addFile(newFile);
  };

  const handleRemoveFile = (fileIndex: number) => {
    setArcgisImportSession(null);
    setQuadratOverlapAcknowledgment(null);
    setServerQuadratOverlapSummaries([]);
    const removed = fileManagement.files[fileIndex];
    if (removed) dropColumnMapping(removed.name);
    const remainingFileCount = fileManagement.files.length - 1;
    uploadState.setDataViewActive(current => {
      const selectedFileIndex = current - FIRST_FILE_VIEW_INDEX;
      const selectionAfterShift = fileIndex < selectedFileIndex ? current - 1 : current;
      return Math.max(FIRST_FILE_VIEW_INDEX, Math.min(selectionAfterShift, remainingFileCount));
    });
    fileManagement.removeFile(fileIndex);
  };

  const handleReplaceFile = async (fileIndex: number, newFile: FileWithPath) => {
    setArcgisImportSession(null);
    setQuadratOverlapAcknowledgment(null);
    setServerQuadratOverlapSummaries([]);
    const replaced = fileManagement.files[fileIndex];
    if (replaced) dropColumnMapping(replaced.name);
    fileManagement.replaceFile(fileIndex, newFile);
  };

  async function parseRevisionFiles(): Promise<FileCollectionRowSet> {
    const { default: Papa } = await import('papaparse');

    const parsedFiles = await Promise.all(
      fileManagement.files.map(
        file =>
          new Promise<[string, Record<string, FileRow>]>((resolve, reject) => {
            Papa.parse<FileRow>(file, {
              delimiter: selectedDelimiters[file.name] || undefined,
              header: true,
              skipEmptyLines: true,
              transformHeader: normalizeRevisionHeader,
              complete(results) {
                const fileRows: Record<string, FileRow> = {};
                results.data.forEach((row, index) => {
                  fileRows[`row-${index}`] = canonicalizeRevisionRow(row);
                });
                resolve([file.name, fileRows]);
              },
              error(err: Error) {
                reject(err);
              }
            });
          })
      )
    );

    return Object.fromEntries(parsedFiles);
  }

  async function handleInitialSubmit() {
    if (uploadState.state.uploadForm === FormType.quadrats && fileManagement.files.length !== 1) {
      errorHandling.setError(new Error('Quadrat uploads require exactly one file. Remove extra files or select a single complete quadrat file.'));
      uploadState.setReviewState(ReviewStates.ERRORS);
      return;
    }

    if (uploadState.state.sourceFormat === SourceFormat.arcgis_xlsx) {
      setArcgisImportSession(null);
      uploadState.setReviewState(ReviewStates.ARCGIS_PREFLIGHT);
    } else if (uploadState.state.uploadMode === UploadMode.REVISIONS && uploadState.state.uploadForm === FormType.measurements) {
      try {
        const stagedParsedData = await parseRevisionFiles();
        setParsedData(stagedParsedData);
        setRevisionMatchResult(null);
        // A fresh file parse is always a NEW upload, never a re-match of a
        // prior attempt — clear so handleRevisionMatch mints a new identity.
        currentUploadAttemptIDRef.current = null;
        setRevisionConfirmNewRows(false);

        // Pre-flight role check: if the file contains spcode and the user is
        // not allowed to edit taxonomic identity, surface a warning before
        // we even hit the match endpoint. Server-side enforcement still
        // backstops at apply.
        const userStatus = session?.user?.userStatus;
        const canEditSpecies = userStatus === 'global' || userStatus === 'db admin';
        if (!canEditSpecies) {
          const filesWithSpCode: string[] = [];
          for (const [fileName, rows] of Object.entries(stagedParsedData)) {
            const firstRow = Object.values(rows)[0];
            if (firstRow && Object.prototype.hasOwnProperty.call(firstRow, 'spcode')) {
              filesWithSpCode.push(fileName);
            }
          }
          if (filesWithSpCode.length > 0) {
            setRevisionRolePreflightWarning(
              `Heads up: ${filesWithSpCode.length === 1 ? `${filesWithSpCode[0]} contains` : `${filesWithSpCode.length} files contain`} a "spcode" column. ` +
                `Species-code changes require global or db admin role and will be blocked at Apply. Other fields will still be applied.`
            );
          } else {
            setRevisionRolePreflightWarning(null);
          }
        } else {
          setRevisionRolePreflightWarning(null);
        }

        uploadState.setReviewState(ReviewStates.REVISION_MATCH);
      } catch (err: unknown) {
        const errorObj = err instanceof Error ? err : new Error(String(err));
        setParsedData({});
        errorHandling.setError(errorObj);
        uploadState.setReviewState(ReviewStates.ERRORS);
      }
    } else if (uploadState.state.uploadForm === FormType.measurements && uploadState.state.uploadMode === UploadMode.CLEAN_REUPLOAD) {
      await requestCleanMeasurementsReplacementConfirmation(() => uploadState.setReviewState(ReviewStates.UPLOAD_SQL));
    } else {
      uploadState.setReviewState(ReviewStates.UPLOAD_SQL);
    }
  }

  function cancelRevisionMatch() {
    revisionMatchAbortControllerRef.current?.abort();
  }

  async function handleRevisionMatch() {
    const files = Object.entries(parsedData).map(([fileName, fileRows]) => ({
      fileName,
      rows: Object.values(fileRows)
    }));

    const controller = new AbortController();
    revisionMatchAbortControllerRef.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(REVISION_MATCH_TIMEOUT_MS)]);

    try {
      const response = await fetch('/api/revisionupload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files,
          plotID: currentPlotID,
          censusID: currentCensusID,
          schema: currentSite?.schemaName,
          // Set only when this call is re-matching the SAME attempt (see the
          // ref's declaration above); omitted for a genuinely new upload, so
          // the match route mints a fresh identity instead of reusing one.
          ...(currentUploadAttemptIDRef.current ? { previousUploadAttemptID: currentUploadAttemptIDRef.current } : {})
        }),
        signal
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(errorBody.error || 'Failed to classify revision rows');
      }

      const result: RevisionUploadResponse = await response.json();
      currentUploadAttemptIDRef.current = result.uploadAttemptID;
      setRevisionMatchResult(result);
    } catch (err: unknown) {
      // A manual abort (cancel button or unmount) means the user has already navigated
      // away -- surfacing an error here would fight that. AbortSignal.timeout's own
      // abort carries a distinct DOMException name, so it still reports as a failure.
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }

      if (err instanceof DOMException && err.name === 'TimeoutError') {
        errorHandling.setError(new Error(`Revision matching timed out after ${REVISION_MATCH_TIMEOUT_MS / 1000}s`));
        uploadState.setReviewState(ReviewStates.ERRORS);
        return;
      }

      const errorObj = err instanceof Error ? err : new Error(String(err));
      errorHandling.setError(errorObj);
      uploadState.setReviewState(ReviewStates.ERRORS);
    }
  }

  // Re-runs match for the SAME upload (parsedData/files untouched) -- unlike
  // every other setRevisionMatchResult(null) call site, currentUploadAttemptIDRef
  // is deliberately NOT cleared here, so the re-match below retains its identity
  // (see the ref's declaration above and route.ts's previousUploadAttemptID).
  function handleRefreshRevisionMatch() {
    setRevisionMatchResult(null);
  }

  useEffect(() => {
    // If the user removes all files, move back to file drop phase
    if (fileManagement.fileCount === 0 && uploadState.state.reviewState === ReviewStates.REVIEW) {
      uploadState.setReviewState(ReviewStates.UPLOAD_FILES);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadState.state.reviewState, fileManagement.fileCount, uploadState.setReviewState]);

  useEffect(() => {
    if (uploadState.state.reviewState === ReviewStates.REVISION_MATCH && !revisionMatchResult && Object.keys(parsedData).length > 0) {
      void handleRevisionMatch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedData, revisionMatchResult, uploadState.state.reviewState]);

  // Abort any in-flight revision-match request on unmount so it doesn't resolve into a
  // component that no longer exists.
  useEffect(() => {
    return () => {
      revisionMatchAbortControllerRef.current?.abort();
    };
  }, []);

  // Check if we should start with reingestion processing (only once on mount)
  useEffect(() => {
    if (skipToProcessing && uploadState.state.uploadForm === FormType.measurements) {
      if (!reingestionInitializedRef.current) {
        ailogger.info('[REINGESTION INIT] Starting reingestion process - setting reviewState to UPLOAD_SQL and reingestion mode');
        reingestionInitializedRef.current = true;
        setIsReingestionMode(true);
        uploadState.setReviewState(ReviewStates.UPLOAD_SQL);
      } else {
        ailogger.info('[REINGESTION GUARD] Reingestion already initialized - ref guard preventing re-initialization');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipToProcessing, uploadState.state.uploadForm, uploadState.setReviewState]);

  const renderStateContent = () => {
    // Note: Invalid state handling (uploadForm undefined when not at START)
    // is now handled in useEffect above to avoid React error #185
    switch (uploadState.state.reviewState) {
      case ReviewStates.START:
        return (
          <UploadStart
            uploadForm={uploadState.state.uploadForm}
            uploadMode={uploadState.state.uploadMode}
            setUploadForm={uploadState.setUploadForm}
            setUploadMode={uploadState.setUploadMode}
            setExpectedHeaders={() => {}} // Deprecated - no longer needed
            setReviewState={uploadState.setReviewState}
            personnelRecording={uploadState.state.personnelRecording}
            setPersonnelRecording={uploadState.setPersonnelRecording}
          />
        );
      case ReviewStates.UPLOAD_FILES:
        return (
          <UploadParseFiles
            uploadForm={uploadState.state.uploadForm}
            uploadMode={uploadState.state.uploadMode}
            sourceFormat={uploadState.state.sourceFormat}
            acceptedFiles={fileManagement.files}
            dataViewActive={uploadState.state.dataViewActive}
            setDataViewActive={uploadState.setDataViewActive}
            handleInitialSubmit={handleInitialSubmit}
            handleAddFile={handleAddFile}
            handleRemoveFile={handleRemoveFile}
            handleReplaceFile={handleReplaceFile}
            selectedDelimiters={selectedDelimiters}
            setSelectedDelimiters={setSelectedDelimiters}
            columnMappings={columnMappings}
            setColumnMappingForFile={setColumnMappingForFile}
            quadratOverlapAcknowledgment={quadratOverlapAcknowledgment}
            setQuadratOverlapAcknowledgment={setQuadratOverlapAcknowledgment}
            serverQuadratOverlapSummaries={serverQuadratOverlapSummaries}
            clearServerQuadratOverlapSummaries={clearServerQuadratOverlapSummaries}
          />
        );
      case ReviewStates.ARCGIS_PREFLIGHT:
        return (
          <UploadArcgisPreflight
            acceptedFiles={fileManagement.files}
            schema={currentSite?.schemaName || ''}
            plotID={currentPlotID ?? 0}
            censusID={currentCensusID ?? 0}
            onProceed={importSession => {
              // ArcGIS workbooks are always imported as a clean re-upload of
              // measurements (see UploadParentModal) -- route through the same
              // replacement confirmation as the CSV clean-re-upload path before
              // committing.
              void requestCleanMeasurementsReplacementConfirmation(() => {
                setArcgisImportSession(importSession);
                uploadState.setReviewState(ReviewStates.UPLOAD_SQL);
              });
            }}
            onBack={() => uploadState.setReviewState(ReviewStates.UPLOAD_FILES)}
            onError={error => {
              errorHandling.setError(error);
              uploadState.setReviewState(ReviewStates.ERRORS);
            }}
          />
        );
      case ReviewStates.UPLOAD_SQL:
        // If in reingestion mode, use reingestion component
        if (isReingestionMode) {
          return (
            <UploadReingestion
              schema={currentSite?.schemaName || ''}
              setReviewState={uploadState.setReviewState}
              setIsDataUnsaved={uploadState.setIsDataUnsaved}
            />
          );
        }
        if (asyncUploadEnabled) {
          return (
            <UploadAsyncJob
              acceptedFiles={fileManagement.files}
              parsedData={parsedData}
              uploadForm={uploadState.state.uploadForm}
              uploadMode={uploadState.state.uploadMode}
              sourceFormat={uploadState.state.sourceFormat}
              selectedDelimiters={selectedDelimiters}
              columnMappings={columnMappings}
              arcgisImportSession={arcgisImportSession}
              setReviewState={uploadState.setReviewState}
              setIsDataUnsaved={uploadState.setIsDataUnsaved}
              setUploadError={(error: any) => errorHandling.setError(error)}
              setErrorComponent={errorHandling.setErrorComponent}
              onClose={onReset}
            />
          );
        }
        return (
          <UploadFireSQL
            personnelRecording={uploadState.state.personnelRecording}
            acceptedFiles={fileManagement.files}
            uploadForm={uploadState.state.uploadForm}
            uploadMode={uploadState.state.uploadMode}
            sourceFormat={uploadState.state.sourceFormat}
            parsedData={parsedData}
            arcgisImportSession={arcgisImportSession}
            setReviewState={uploadState.setReviewState}
            setIsDataUnsaved={uploadState.setIsDataUnsaved}
            schema={currentSite?.schemaName || ''}
            uploadCompleteMessage={uploadState.state.uploadCompleteMessage}
            setUploadCompleteMessage={uploadState.setUploadCompleteMessage}
            setUploadError={(error: any) => errorHandling.setError(error)}
            setErrorComponent={errorHandling.setErrorComponent}
            setAllRowToCMID={setAllRowToCMID}
            selectedDelimiters={selectedDelimiters}
            columnMappings={columnMappings}
            quadratOverlapAcknowledgment={quadratOverlapAcknowledgment}
            onQuadratOverlapAcknowledgmentRequired={handleQuadratOverlapAcknowledgmentRequired}
          />
        );
      case ReviewStates.REVISION_MATCH:
        // UploadRevisionMatch chooses its opening tab from row counts, and MUI Joy
        // reads Tabs.defaultValue only on the uncontrolled mount. Mounting with the
        // `?? []` empties while the match request is still in flight would lock the
        // selection to the empty-state tab, so wait for the response instead.
        if (!revisionMatchResult) {
          return (
            <Stack spacing={2} alignItems="center" sx={{ p: 3 }}>
              <CircularProgress />
              <Typography level="body-md">Matching revision rows&hellip;</Typography>
              <Button
                variant="outlined"
                color="neutral"
                onClick={() => {
                  cancelRevisionMatch();
                  void handleReturnToStart();
                }}
              >
                Cancel and return to start
              </Button>
            </Stack>
          );
        }
        return (
          <UploadRevisionMatch
            matchedRows={revisionMatchResult.matchedRows}
            newRows={revisionMatchResult.newRows}
            invalidRows={revisionMatchResult.invalidRows}
            collapsedRows={revisionMatchResult.collapsedRows}
            counts={revisionMatchResult.counts}
            bulkPlan={revisionMatchResult.bulkPlan}
            schema={currentSite?.schemaName || ''}
            plotID={currentPlotID ?? 0}
            censusID={currentCensusID ?? 0}
            preflightWarning={revisionRolePreflightWarning}
            setReviewState={uploadState.setReviewState}
            onApply={confirmNew => {
              setRevisionConfirmNewRows(confirmNew);
              uploadState.setReviewState(ReviewStates.REVISION_APPLY);
            }}
            handleReturnToStart={handleReturnToStart}
            onRefreshMatch={handleRefreshRevisionMatch}
          />
        );
      case ReviewStates.REVISION_APPLY:
        return (
          <UploadRevisionApply
            matchedRows={(revisionMatchResult?.matchedRows ?? []).map(row => ({
              csvIndex: row.csvIndex,
              coreMeasurementID: row.coreMeasurementID,
              csvRow: row.csvRow,
              duplicateMeasurementIDsToDelete: row.duplicateMeasurementIDsToDelete ?? []
            }))}
            newRows={(revisionMatchResult?.newRows ?? []).map(row => ({ csvRow: row.csvRow, csvIndex: row.csvIndex }))}
            invalidRows={revisionMatchResult?.invalidRows ?? []}
            confirmNewRows={revisionConfirmNewRows}
            schema={currentSite?.schemaName || ''}
            bulkPlanHash={revisionMatchResult?.bulkPlan?.planHash ?? ''}
            uploadAttemptID={revisionMatchResult?.uploadAttemptID ?? ''}
            invalidRowsIntegrityHash={revisionMatchResult?.invalidRowsIntegrityHash ?? ''}
            setReviewState={uploadState.setReviewState}
            setIsDataUnsaved={uploadState.setIsDataUnsaved}
            onPlanConflict={(freshPlan, freshInvalidRows, freshInvalidRowsIntegrityHash) => {
              setRevisionMatchResult(current =>
                current ? mergeFreshRevisionPlan(current, freshPlan, freshInvalidRows, freshInvalidRowsIntegrityHash) : current
              );
            }}
          />
        );
      case ReviewStates.VALIDATE:
        return <UploadValidation setReviewState={uploadState.setReviewState} schema={currentSite?.schemaName || ''} isReingestion={isReingestionMode} />;
      case ReviewStates.VALIDATE_ERRORS_FOUND:
        return <UploadValidationErrors setReviewState={uploadState.setReviewState} isReingestion={isReingestionMode} />;
      case ReviewStates.UPDATE:
        return <UploadUpdateValidations setReviewState={uploadState.setReviewState} schema={currentSite?.schemaName || ''} />;
      case ReviewStates.UPLOAD_AZURE:
        return (
          <UploadFireAzure
            acceptedFiles={fileManagement.files}
            uploadForm={uploadState.state.uploadForm}
            sourceFormat={uploadState.state.sourceFormat}
            setReviewState={uploadState.setReviewState}
            setIsDataUnsaved={uploadState.setIsDataUnsaved}
            setUploadError={(error: any) => errorHandling.setError(error)}
            setErrorComponent={errorHandling.setErrorComponent}
            user={session?.user?.name ? session?.user?.name : ''}
            allRowToCMID={allRowToCMID}
          />
        );
      case ReviewStates.COMPLETE:
        return <UploadComplete handleCloseUploadModal={onReset} uploadForm={uploadState.state.uploadForm} />;
      default:
        return (
          <UploadError
            error={errorHandling.error}
            component={errorHandling.errorComponent}
            acceptedFiles={fileManagement.files}
            setAcceptedFiles={value => {
              const files = typeof value === 'function' ? value(fileManagement.files) : value;
              fileManagement.clearFiles();
              files.forEach((file: any) => fileManagement.addFile(file));
            }}
            setReviewState={uploadState.setReviewState}
            handleReturnToStart={handleReturnToStart}
            resetError={resetError}
          />
        );
    }
  };

  // Re-verified at render time (not just when the preview was set): if the scope or any
  // selected File's identity has changed since this preview was computed, the dialog
  // must not show, regardless of what `replacementPreview.status` still says.
  const replacementNeedsConfirmation =
    !!replacementPreview &&
    replacementPreview.status === 'needsConfirmation' &&
    replacementPreview.scopeKey === cleanReplacementScopeKey &&
    filesMatchSnapshot(replacementPreview.filesSnapshot);

  return (
    <ContextValidationGuard
      requireSite={true}
      requirePlot={true}
      requireCensus={true}
      customMessage="Upload functionality requires site, plot, and census selections to be active."
    >
      <>
        <MeasurementReplacementConfirmDialog
          // Keyed on the request id so a brand-new confirmation request always mounts
          // fresh, resetting any previously-typed confirmation text even when the new
          // existingRowCount happens to equal the old one.
          key={replacementPreview?.requestId ?? 'none'}
          open={replacementNeedsConfirmation}
          censusLabel={_currentCensus?.plotCensusNumber !== undefined ? `Census ${_currentCensus.plotCensusNumber}` : 'This census'}
          existingRowCount={replacementPreview?.existingRowCount ?? 0}
          onCancel={handleReplacementCancelled}
          onConfirm={handleReplacementConfirmed}
        />
        <FailedMeasurementsModal
          open={showFailedMeasurementsModal}
          handleCloseModal={async ({ dataChanged = false } = {}) => {
            if (dataChanged) {
              ailogger.info('Failed measurements were reingested successfully');
            }
            ailogger.info('Closing failed measurements modal');
            setShowFailedMeasurementsModal(false);
          }}
        />
        <Box
          sx={{
            display: 'flex',
            width: '100%',
            flexDirection: 'column',
            marginBottom: 2
          }}
        >
          <Typography level={'title-lg'} color={'primary'}>
            Drag and drop files into the box to upload them to storage
          </Typography>
          <Box sx={{ mt: 5, mr: 5, width: '95%' }}>
            <Box sx={{ display: 'flex', width: '100%', flex: 1 }}>{renderStateContent()}</Box>
          </Box>
        </Box>
      </>
    </ContextValidationGuard>
  );
}

// Wrap the component with an ErrorBoundary for graceful error handling
export default function UploadParent(props: UploadParentProps) {
  return (
    <ErrorBoundary componentName="UploadParent">
      <UploadParentInner {...props} />
    </ErrorBoundary>
  );
}
