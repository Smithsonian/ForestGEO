'use client';
import React, { useEffect, useRef, useState } from 'react';
import { ReviewStates } from '@/config/macros/uploadsystemmacros';
import { FileCollectionRowSet, FileRow, FormType, RequiredTableHeadersByFormType } from '@/config/macros/formdetails';
import { FileWithPath } from 'react-dropzone';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/compat-hooks';
import { useSession } from 'next-auth/react';
import { Box, Typography } from '@mui/joy';
import ContextValidationGuard from '@/components/shared/ContextValidationGuard';
import UploadParseFiles from '@/components/uploadsystem/segments/uploadparsefiles';
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
import FailedMeasurementsModal from '@/components/client/modals/failedmeasurementsmodal';
import ailogger from '@/ailogger';
import { useFileManagement } from '@/app/hooks/usefilemanagement';
import { useUploadState } from '@/app/hooks/useuploadstate';
import { useErrorHandling } from '@/app/hooks/useerrorhandling';
import { ErrorBoundary } from '@/components/errorboundary';
import { UploadMode } from '@/config/uploadmodes';
import { canonicalizeRevisionRow, normalizeRevisionHeader } from '@/components/uploadsystemhelpers/revisionfileparse';
import { EMPTY_REVISION_MATCH_COUNTS, RevisionInvalidRow, RevisionMatchedRow, RevisionUploadResponse } from '@/config/revisionuploadtypes';
import { BulkEditPlan } from '@/config/editplan/types';

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

function mergeFreshRevisionPlan(result: RevisionUploadResponse, freshPlan: BulkEditPlan): RevisionUploadResponse {
  const changesByTarget = new Map<number, Record<string, { from: unknown; to: unknown }>>();
  const invalidByTarget = new Map<number, string>();
  const invalidByCsvIndex = new Map<number, string>();
  for (const rowPlan of freshPlan.rowPlans) {
    if (rowPlan.status === 'invalid') {
      const reason = rowPlan.reason ?? 'Row failed validation';
      if (rowPlan.targetID !== undefined) invalidByTarget.set(rowPlan.targetID, reason);
      invalidByCsvIndex.set(rowPlan.rowIndex, reason);
      continue;
    }
    if (rowPlan.targetID === undefined) continue;
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const change of rowPlan.plan?.fieldChanges ?? []) {
      changes[change.field] = { from: change.from, to: change.to };
    }
    changesByTarget.set(rowPlan.targetID, changes);
  }

  const matchedRows: RevisionMatchedRow[] = [];
  const demotedInvalidRows: RevisionInvalidRow[] = [];
  for (const row of result.matchedRows) {
    const invalidReason = invalidByTarget.get(row.coreMeasurementID) ?? invalidByCsvIndex.get(row.csvIndex);
    if (invalidReason !== undefined) {
      demotedInvalidRows.push({
        csvRow: row.csvRow,
        csvIndex: row.csvIndex,
        reason: invalidReason
      });
      continue;
    }
    matchedRows.push({
      ...row,
      changes: changesByTarget.get(row.coreMeasurementID) ?? row.changes
    });
  }

  const invalidRows = [...result.invalidRows, ...demotedInvalidRows];
  const matchedWithChanges = matchedRows.filter(row => Object.keys(row.changes).length > 0 || (row.duplicateMeasurementIDsToDelete?.length ?? 0) > 0).length;

  return {
    ...result,
    matchedRows,
    invalidRows,
    counts: {
      ...result.counts,
      matched: matchedRows.length,
      matchedWithChanges,
      invalid: invalidRows.length,
      total: matchedRows.length + result.newRows.length + invalidRows.length
    },
    bulkPlan: freshPlan
  };
}

interface UploadParentProps {
  onReset: () => void;
  overrideUploadForm?: FormType;
  overrideUploadMode?: UploadMode;
  skipToProcessing?: boolean;
  onUploadComplete?: () => void;
}

function UploadParentInner(props: UploadParentProps) {
  const { onReset, overrideUploadForm, overrideUploadMode, skipToProcessing, onUploadComplete } = props;

  // Custom hooks for state management
  const fileManagement = useFileManagement();
  const uploadState = useUploadState(overrideUploadForm, skipToProcessing, overrideUploadMode);
  const errorHandling = useErrorHandling();

  // Remaining local state (not managed by custom hooks)
  const [parsedData, setParsedData] = useState<FileCollectionRowSet>({});
  const [allRowToCMID, setAllRowToCMID] = useState<DetailedCMIDRow[]>([]);
  const [selectedDelimiters, setSelectedDelimiters] = useState<Record<string, string>>({});
  const [showFailedMeasurementsModal, setShowFailedMeasurementsModal] = useState(false);
  const [isReingestionMode, setIsReingestionMode] = useState(false);
  const [revisionMatchResult, setRevisionMatchResult] = useState<RevisionUploadResponse | null>(null);
  const [revisionConfirmNewRows, setRevisionConfirmNewRows] = useState(false);
  // Pre-flight: when a non-admin user uploads a revisions CSV containing
  // taxonomic-identity columns (spcode), the apply phase will hit
  // revisionRolePolicy and block. Surface this at the parse step so the user
  // doesn't reach the match review only to fail at Apply.
  const [revisionRolePreflightWarning, setRevisionRolePreflightWarning] = useState<string | null>(null);
  const [arcgisPreparedRows, setArcgisPreparedRows] = useState<FileCollectionRowSet | null>(null);

  // Track if we've already initialized reingestion to prevent re-triggering
  const reingestionInitializedRef = useRef(false);

  // Context and session
  const _currentPlot = usePlotContext();
  const _currentCensus = useOrgCensusContext();
  const currentSite = useSiteContext();
  const { data: session } = useSession();

  const currentPlotID = _currentPlot?.plotID ?? null;
  const currentCensusID = _currentCensus?.dateRanges?.[0]?.censusID ?? null;

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
      setParsedData({});
      setIsReingestionMode(false);
      setRevisionMatchResult(null);
      setRevisionConfirmNewRows(false);
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
    setParsedData({});
    setIsReingestionMode(false);
    setRevisionMatchResult(null);
    setRevisionConfirmNewRows(false);
  }

  async function resetError() {
    errorHandling.clearError();
  }

  // Function to handle file addition
  const handleAddFile = (newFile: FileWithPath) => {
    fileManagement.addFile(newFile);
  };

  const handleRemoveFile = (fileIndex: number) => {
    fileManagement.removeFile(fileIndex);
  };

  const handleReplaceFile = async (fileIndex: number, newFile: FileWithPath) => {
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
    if (uploadState.state.uploadMode === UploadMode.REVISIONS && uploadState.state.uploadForm === FormType.measurements) {
      try {
        const stagedParsedData = await parseRevisionFiles();
        setParsedData(stagedParsedData);
        setRevisionMatchResult(null);
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
    } else if (uploadState.state.uploadForm === FormType.arcgis_xlsx) {
      setArcgisPreparedRows(null);
      uploadState.setReviewState(ReviewStates.ARCGIS_PREFLIGHT);
    } else {
      uploadState.setReviewState(ReviewStates.UPLOAD_SQL);
    }
  }

  async function handleRevisionMatch() {
    const files = Object.entries(parsedData).map(([fileName, fileRows]) => ({
      fileName,
      rows: Object.values(fileRows)
    }));

    try {
      const response = await fetch('/api/revisionupload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files,
          plotID: currentPlotID,
          censusID: currentCensusID,
          schema: currentSite?.schemaName
        })
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(errorBody.error || 'Failed to classify revision rows');
      }

      const result: RevisionUploadResponse = await response.json();
      setRevisionMatchResult(result);
    } catch (err: unknown) {
      const errorObj = err instanceof Error ? err : new Error(String(err));
      errorHandling.setError(errorObj);
      uploadState.setReviewState(ReviewStates.ERRORS);
    }
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
            setSourceFormat={uploadState.setSourceFormat}
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
            acceptedFiles={fileManagement.files}
            dataViewActive={uploadState.state.dataViewActive}
            setDataViewActive={uploadState.setDataViewActive}
            handleInitialSubmit={handleInitialSubmit}
            handleAddFile={handleAddFile}
            handleRemoveFile={handleRemoveFile}
            handleReplaceFile={handleReplaceFile}
            selectedDelimiters={selectedDelimiters}
            setSelectedDelimiters={setSelectedDelimiters}
          />
        );
      case ReviewStates.ARCGIS_PREFLIGHT:
        return (
          <UploadArcgisPreflight
            acceptedFiles={fileManagement.files}
            onProceed={rows => {
              setArcgisPreparedRows(rows);
              uploadState.setReviewState(ReviewStates.UPLOAD_SQL);
            }}
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
        return (
          <UploadFireSQL
            personnelRecording={uploadState.state.personnelRecording}
            acceptedFiles={fileManagement.files}
            uploadForm={uploadState.state.uploadForm}
            uploadMode={uploadState.state.uploadMode}
            parsedData={parsedData}
            preparedRowSet={arcgisPreparedRows}
            setReviewState={uploadState.setReviewState}
            setIsDataUnsaved={uploadState.setIsDataUnsaved}
            schema={currentSite?.schemaName || ''}
            uploadCompleteMessage={uploadState.state.uploadCompleteMessage}
            setUploadCompleteMessage={uploadState.setUploadCompleteMessage}
            setUploadError={(error: any) => errorHandling.setError(error)}
            setErrorComponent={errorHandling.setErrorComponent}
            setAllRowToCMID={setAllRowToCMID}
            selectedDelimiters={selectedDelimiters}
          />
        );
      case ReviewStates.REVISION_MATCH:
        return (
          <UploadRevisionMatch
            matchedRows={revisionMatchResult?.matchedRows ?? []}
            newRows={revisionMatchResult?.newRows ?? []}
            invalidRows={revisionMatchResult?.invalidRows ?? []}
            counts={revisionMatchResult?.counts ?? EMPTY_REVISION_MATCH_COUNTS}
            bulkPlan={revisionMatchResult?.bulkPlan}
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
            setReviewState={uploadState.setReviewState}
            setIsDataUnsaved={uploadState.setIsDataUnsaved}
            onPlanConflict={freshPlan => {
              setRevisionMatchResult(current => (current ? mergeFreshRevisionPlan(current, freshPlan) : current));
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
  return (
    <ContextValidationGuard
      requireSite={true}
      requirePlot={true}
      requireCensus={true}
      customMessage="Upload functionality requires site, plot, and census selections to be active."
    >
      <>
        <FailedMeasurementsModal
          open={showFailedMeasurementsModal}
          setReingested={reingested => {
            if (reingested) {
              ailogger.info('Failed measurements were reingested successfully');
              // Close modal and return to start for reingestion processing
              setShowFailedMeasurementsModal(false);
            }
          }}
          handleCloseModal={async () => {
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
