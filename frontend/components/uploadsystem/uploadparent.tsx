'use client';
import React, { useEffect, useState } from 'react';
import { ReviewStates } from '@/config/macros/uploadsystemmacros';
import { FileCollectionRowSet, FileRow, FormType, RequiredTableHeadersByFormType } from '@/config/macros/formdetails';
import { FileWithPath } from 'react-dropzone';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';
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
import FailedMeasurementsModal from '@/components/client/modals/failedmeasurementsmodal';
import ailogger from '@/ailogger';
import { useFileManagement } from '@/app/hooks/useFileManagement';
import { useUploadState } from '@/app/hooks/useUploadState';
import { useErrorHandling } from '@/app/hooks/useErrorHandling';

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
  skipToProcessing?: boolean;
  onUploadComplete?: () => void;
}

export default function UploadParent(props: UploadParentProps) {
  const { onReset, overrideUploadForm, skipToProcessing, onUploadComplete } = props;

  // Custom hooks for state management
  const fileManagement = useFileManagement();
  const uploadState = useUploadState(overrideUploadForm, skipToProcessing);
  const errorHandling = useErrorHandling();

  // Remaining local state (not managed by custom hooks)
  const [parsedData, setParsedData] = useState<FileCollectionRowSet>({});
  const [allRowToCMID, setAllRowToCMID] = useState<DetailedCMIDRow[]>([]);
  const [selectedDelimiters, setSelectedDelimiters] = useState<Record<string, string>>({});
  const [showFailedMeasurementsModal, setShowFailedMeasurementsModal] = useState(false);

  // Context and session
  const _currentPlot = usePlotContext();
  const _currentCensus = useOrgCensusContext();
  const currentSite = useSiteContext();
  const { data: session } = useSession();

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
    if (uploadState.state.reviewState === ReviewStates.COMPLETE && onUploadComplete) {
      onUploadComplete();
    }
  }, [uploadState.state.reviewState, onUploadComplete]);

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
    uploadState.setReviewState(ReviewStates.UPLOAD_SQL);
  }

  useEffect(() => {
    // If the user removes all files, move back to file drop phase
    if (fileManagement.fileCount === 0 && uploadState.state.reviewState === ReviewStates.REVIEW) {
      uploadState.setReviewState(ReviewStates.UPLOAD_FILES);
    }
  }, [uploadState.state.reviewState, fileManagement.fileCount, uploadState]);

  // Check if we should start with reingestion processing
  useEffect(() => {
    if (skipToProcessing && uploadState.state.uploadForm === FormType.measurements) {
      ailogger.info('Skipping to reingestion processing stage');
      uploadState.setReviewState(ReviewStates.UPLOAD_SQL);
    }
  }, [skipToProcessing, uploadState]);

  const renderStateContent = () => {
    if (!uploadState.state.uploadForm && uploadState.state.reviewState !== ReviewStates.START) {
      handleReturnToStart().catch(ailogger.error);
    }
    switch (uploadState.state.reviewState) {
      case ReviewStates.START:
        return (
          <UploadStart
            uploadForm={uploadState.state.uploadForm}
            setUploadForm={uploadState.setUploadForm}
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
        // If skipToProcessing is true and there are no files, use reingestion component
        if (skipToProcessing && fileManagement.fileCount === 0) {
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
      case ReviewStates.VALIDATE:
        return <UploadValidation setReviewState={uploadState.setReviewState} schema={currentSite?.schemaName || ''} />;
      case ReviewStates.VALIDATE_ERRORS_FOUND:
        return (
          <UploadValidationErrors
            setReviewState={uploadState.setReviewState}
            onViewFailedMeasurements={() => {
              ailogger.info('Opening Failed Measurements Modal from validation errors screen');
              setShowFailedMeasurementsModal(true);
            }}
          />
        );
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
          onTriggerReingestion={() => {
            ailogger.info('Triggering reingestion from failed measurements modal');
            setShowFailedMeasurementsModal(false);
            // Note: Reingestion will be handled by the modal's own logic
            // which moves data to temporarymeasurements and triggers reprocessing
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
