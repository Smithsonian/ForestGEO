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
import FailedMeasurementsModal from '@/components/client/modals/failedmeasurementsmodal';
import ailogger from '@/ailogger';
import { useFileManagement } from '@/app/hooks/usefilemanagement';
import { useUploadState } from '@/app/hooks/useuploadstate';
import { useErrorHandling } from '@/app/hooks/useerrorhandling';
import { ErrorBoundary } from '@/components/errorboundary';
import { UploadMode } from '@/config/uploadmodes';

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
  const [revisionMatchResult, setRevisionMatchResult] = useState<any>(null);
  const [revisionConfirmNewRows, setRevisionConfirmNewRows] = useState(false);

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

  async function handleInitialSubmit() {
    if (
      uploadState.state.uploadMode === UploadMode.REVISIONS &&
      uploadState.state.uploadForm === FormType.measurements
    ) {
      uploadState.setReviewState(ReviewStates.REVISION_MATCH);
    } else {
      uploadState.setReviewState(ReviewStates.UPLOAD_SQL);
    }
  }

  async function handleRevisionMatch() {
    const allRows: FileRow[] = [];

    await Promise.all(
      fileManagement.files.map(
        file =>
          new Promise<void>((resolve, reject) => {
            import('papaparse').then(({ default: Papa }) => {
              Papa.parse<FileRow>(file, {
                header: true,
                skipEmptyLines: true,
                transformHeader: (header: string) => header.trim().toLowerCase().replace(/[_\s-]/g, ''),
                complete(results) {
                  allRows.push(...results.data);
                  resolve();
                },
                error(err: Error) {
                  reject(err);
                }
              });
            });
          })
      )
    );

    try {
      const response = await fetch('/api/revisionupload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: allRows,
          plotID: currentPlotID,
          censusID: currentCensusID,
          schema: currentSite?.schemaName
        })
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(errorBody.error || 'Failed to classify revision rows');
      }

      const result = await response.json();
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
    if (uploadState.state.reviewState === ReviewStates.REVISION_MATCH && !revisionMatchResult) {
      handleRevisionMatch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadState.state.reviewState]);

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
            counts={revisionMatchResult?.counts ?? { matched: 0, matchedWithChanges: 0, new: 0, invalid: 0, total: 0 }}
            schema={currentSite?.schemaName || ''}
            plotID={currentPlotID ?? 0}
            censusID={currentCensusID ?? 0}
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
            matchedRows={(revisionMatchResult?.matchedRows ?? [])
              .filter((r: any) => Object.keys(r.changes).length > 0)
              .map((r: any) => ({ coreMeasurementID: r.coreMeasurementID, csvRow: r.csvRow }))}
            newRows={(revisionMatchResult?.newRows ?? []).map((r: any) => r.csvRow)}
            confirmNewRows={revisionConfirmNewRows}
            schema={currentSite?.schemaName || ''}
            setReviewState={uploadState.setReviewState}
            setIsDataUnsaved={uploadState.setIsDataUnsaved}
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
