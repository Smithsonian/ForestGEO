'use client';
import React, { useEffect, useState } from 'react';
import { FileWithStream, ReviewStates } from '@/config/macros/uploadsystemmacros';
import { FileCollectionRowSet, FileRow, FileRowSet, FormType, getTableHeaders, RequiredTableHeadersByFormType } from '@/config/macros/formdetails';
import { FileWithPath } from 'react-dropzone';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import { useSession } from 'next-auth/react';
import { parse, ParseResult } from 'papaparse';
import { Box, Typography } from '@mui/joy';
import UploadParseFiles from '@/components/uploadsystem/segments/uploadparsefiles';
import UploadFireSQL from '@/components/uploadsystem/segments/uploadfiresql';
import UploadError from '@/components/uploadsystem/segments/uploaderror';
import UploadValidation from '@/components/uploadsystem/segments/uploadvalidation';
import UploadUpdateValidations from '@/components/uploadsystem/segments/uploadupdatevalidations';
import UploadStart from '@/components/uploadsystem/segments/uploadstart';
import UploadFireAzure from '@/components/uploadsystem/segments/uploadfireazure';
import UploadComplete from '@/components/uploadsystem/segments/uploadcomplete';
import moment from 'moment';

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
  onReset: () => void; // closes the modal
  overrideUploadForm?: FormType;
}

export default function UploadParent(props: UploadParentProps) {
  const { onReset, overrideUploadForm } = props;
  /**
   * this will be the new parent upload function that will then pass data to child components being called within
   */
  // select schema table that file should be uploaded to --> state
  const [uploadForm, setUploadForm] = useState<FormType | undefined>(overrideUploadForm);
  const [personnelRecording, setPersonnelRecording] = useState('');

  // core enum to handle state progression
  const [reviewState, setReviewState] = useState<ReviewStates>(ReviewStates.UPLOAD_FILES);
  // dropped file storage
  const [acceptedFiles, setAcceptedFiles] = useState<FileWithStream[]>([]);
  // pagination counter to manage validation table view/allow scroll through files in REVIEW
  const [dataViewActive, setDataViewActive] = useState(1);
  // for REVIEW --> storage of parsed data for display
  const [parsedData, setParsedData] = useState<FileCollectionRowSet>({});
  const [errorRows, setErrorRows] = useState<FileCollectionRowSet>({});
  const [errors, setErrors] = useState<FileCollectionRowSet>({});
  // Confirmation menu states:
  const [currentFileHeaders, setCurrentFileHeaders] = useState<string[]>([]);
  const [expectedHeaders, setExpectedHeaders] = useState<string[]>([]);
  const [uploadCompleteMessage, setUploadCompleteMessage] = useState('');
  const [allFileHeaders, setAllFileHeaders] = useState<Record<string, string[]>>({});
  const [isDataUnsaved, setIsDataUnsaved] = useState(false);
  const [uploadError, setUploadError] = useState<any>();
  const [errorComponent, setErrorComponent] = useState('');
  const [allRowToCMID, setAllRowToCMID] = useState<DetailedCMIDRow[]>([]);
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const currentSite = useSiteContext();
  if (!currentSite) throw new Error('site must be selected!');
  const { data: session } = useSession();
  const PARSING_TIME_THRESHOLD_MS = 5000; // 5 second limit for full-file parsing
  const [isStreaming, setIsStreaming] = useState(false);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isDataUnsaved) {
        event.preventDefault(); // Required to standardize behavior across browsers
        event.returnValue = ''; // In modern browsers, the message is not customizable but setting returnValue is necessary
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isDataUnsaved]); // Run the effect when isDataUnsaved changes

  function areHeadersValid(actualHeaders: string[]): {
    isValid: boolean;
    missingHeaders: string[];
  } {
    if (!uploadForm) throw new Error('No upload form set!');
    const requiredHeaders = RequiredTableHeadersByFormType[uploadForm];
    const requiredExpectedHeadersLower = requiredHeaders.map(header => header.label.toLowerCase());
    const actualHeadersLower = actualHeaders.map(header => header.toLowerCase());

    const missingHeaders = requiredExpectedHeadersLower.filter(expectedHeader => !actualHeadersLower.includes(expectedHeader));

    return {
      isValid: missingHeaders.length === 0,
      missingHeaders: missingHeaders.map(header => header.charAt(0).toUpperCase() + header.slice(1))
    };
  }

  async function handleReturnToStart() {
    setDataViewActive(1);
    setAcceptedFiles([]);
    setParsedData({});
    setErrors({});
    setErrorRows({});
    setUploadForm(undefined);
    setPersonnelRecording('');
    setReviewState(ReviewStates.START);
  }

  async function resetError() {
    setUploadError(null);
    setErrorComponent('');
  }

  // Function to handle file addition
  const handleAddFile = (newFile: FileWithPath) => {
    // setAcceptedFiles(prevFiles => [...prevFiles, parseStreamCheck(newFile, setAllFileHeaders)]);
    setAcceptedFiles(prevFiles => [...prevFiles, new FileWithStream(newFile, true, newFile.path)]);
  };

  const handleRemoveFile = (fileIndex: number) => {
    const fileToRemove = acceptedFiles[fileIndex];
    setAcceptedFiles(prevFiles => prevFiles.filter((_, index) => index !== fileIndex));

    // Remove the headers of the deleted file
    setAllFileHeaders(prevHeaders => {
      const updatedHeaders = { ...prevHeaders };
      delete updatedHeaders[fileToRemove.name];
      return updatedHeaders;
    });
  };

  const handleReplaceFile = async (fileIndex: number, newFile: FileWithPath) => {
    const fileToReplace = acceptedFiles[fileIndex];
    console.log('filetoreplace: ', fileToReplace);
    setAcceptedFiles(prevFiles => [...prevFiles.slice(0, fileIndex), new FileWithStream(newFile, true, newFile.path), ...prevFiles.slice(fileIndex + 1)]);

    // Update headers after replacement
    setAllFileHeaders(prevHeaders => {
      const updatedHeaders = { ...prevHeaders };
      delete updatedHeaders[fileToReplace.name];
      return updatedHeaders;
    });
  };

  const parseFullFile = async (file: FileWithPath) => {
    try {
      const isCSV = file.name.endsWith('.csv');
      const delimiter = isCSV ? ',' : '\t';

      parse<FileRow>(file as File, {
        delimiter: delimiter,
        header: true,
        skipEmptyLines: true,
        chunkSize: 1024,
        transformHeader: h => h.trim(),
        transform: (value, field) => {
          if (uploadForm === FormType.measurements && field === 'date') {
            const match = value.match(/(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})|(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);

            if (match) {
              let normalizedDate;
              if (match[1]) {
                normalizedDate = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
              } else {
                normalizedDate = `${match[6]}-${match[5].padStart(2, '0')}-${match[4].padStart(2, '0')}`;
              }

              const parsedDate = moment(normalizedDate, 'YYYY-MM-DD', true);
              if (parsedDate.isValid()) {
                return parsedDate.toDate();
              } else {
                console.error(`Invalid date format for value: ${value}. Accepted formats are YYYY-MM-DD and DD-MM-YYYY.`);
                return value;
              }
            } else {
              console.error(`Invalid date format for value: ${value}. Accepted formats are YYYY-MM-DD and DD-MM-YYYY.`);
              return value;
            }
          }
          return value;
        },
        complete: async (results: ParseResult<FileRow>) => {
          if (!uploadForm) throw new Error('Upload form set failure');
          const expectedHeaders = getTableHeaders(uploadForm, currentPlot?.usesSubquadrats ?? false);
          const requiredHeaders = RequiredTableHeadersByFormType[uploadForm];

          if (!expectedHeaders || !requiredHeaders) {
            console.error(`No headers defined for form type: ${uploadForm}`);
            setReviewState(ReviewStates.FILE_MISMATCH_ERROR);
            return;
          }

          const updatedFileRowSet: FileRowSet = {};
          const fileErrors: FileRowSet = {};

          for (const [index, row] of results.data.entries()) {
            const rowId = `row-${index}`;
            const updatedRow: FileRow = { ...row };

            expectedHeaders.forEach(header => {
              const headerLabel = header.label;
              if (!(headerLabel in row)) {
                updatedRow[header.label] = null;
              }
            });

            updatedFileRowSet[rowId] = updatedRow;

            const rowErrors: FileRow = {};
            let hasError = false;

            for (const header of requiredHeaders) {
              const value = row[header.label];
              if (value === null || value === undefined || value === '' || value === 'NULL') {
                rowErrors[header.label] = 'This field is required';
                hasError = true;
              }
            }

            if (hasError) {
              fileErrors[rowId] = rowErrors;
            }
          }

          setParsedData(prevParsedData => ({
            ...prevParsedData,
            [file.name]: updatedFileRowSet
          }));
          setErrorRows(prevErrorRows => ({
            ...prevErrorRows,
            [file.name]: updatedFileRowSet
          }));
          setErrors(prevErrors => ({
            ...prevErrors,
            [file.name]: fileErrors
          }));
        }
      });
    } catch (error: any) {
      const errorWithFile = {
        message: error.message,
        file: file.name,
        originalError: error
      };
      setUploadError(errorWithFile);
      setErrorComponent('UploadParseFiles');
      setReviewState(ReviewStates.ERRORS);
    }
  };

  async function handleInitialSubmit() {
    // setReviewState(ReviewStates.REVIEW);
    setReviewState(ReviewStates.UPLOAD_SQL);
  }

  useEffect(() => {
    if (acceptedFiles.length > 0 && dataViewActive <= acceptedFiles.length) {
      const currentFile = acceptedFiles[dataViewActive - 1];
      if (currentFile && allFileHeaders[currentFile.name]) {
        setCurrentFileHeaders(allFileHeaders[currentFile.name]);
      } else {
        setCurrentFileHeaders([]);
      }
    }
    if (acceptedFiles.length === 0 && reviewState === ReviewStates.REVIEW) setReviewState(ReviewStates.UPLOAD_FILES); // if the user removes all files, move back to file drop phase
  }, [reviewState, dataViewActive, acceptedFiles, setCurrentFileHeaders, allFileHeaders]);

  const renderStateContent = () => {
    if (!uploadForm && reviewState !== ReviewStates.START) handleReturnToStart().catch(console.error);
    switch (reviewState) {
      case ReviewStates.START:
        return (
          <UploadStart
            uploadForm={uploadForm}
            setUploadForm={setUploadForm}
            setExpectedHeaders={setExpectedHeaders}
            setReviewState={setReviewState}
            personnelRecording={personnelRecording}
            setPersonnelRecording={setPersonnelRecording}
          />
        );
      case ReviewStates.UPLOAD_FILES:
        return (
          <UploadParseFiles
            uploadForm={uploadForm}
            acceptedFiles={acceptedFiles}
            personnelRecording={personnelRecording}
            dataViewActive={dataViewActive}
            setDataViewActive={setDataViewActive}
            parseFullFile={parseFullFile}
            handleInitialSubmit={handleInitialSubmit}
            handleAddFile={handleAddFile}
            handleRemoveFile={handleRemoveFile}
            handleReplaceFile={handleReplaceFile}
          />
        );
      // case ReviewStates.REVIEW:
      //   return (
      //     <UploadReviewFiles
      //       dbhUnit={dbhUnit}
      //       homUnit={homUnit}
      //       coordUnit={coordUnit}
      //       acceptedFiles={acceptedFiles}
      //       setAcceptedFiles={setAcceptedFiles}
      //       uploadForm={uploadForm}
      //       errors={errors}
      //       errorRows={errorRows}
      //       parsedData={parsedData}
      //       expectedHeaders={expectedHeaders}
      //       currentFileHeaders={currentFileHeaders}
      //       dataViewActive={dataViewActive}
      //       setDataViewActive={setDataViewActive}
      //       areHeadersValid={areHeadersValid}
      //       setErrors={setErrors}
      //       setErrorRows={setErrorRows}
      //       setReviewState={setReviewState}
      //       confirmationDialogOpen={confirmationDialogOpen}
      //       setParsedData={setParsedData}
      //       handleConfirm={handleConfirmationConfirm}
      //       handleCancel={handleConfirmationCancel}
      //       handleApproval={handleConfirmationApproval}
      //       handleChange={handleChange}
      //       setUploadError={setUploadError}
      //       setErrorComponent={setErrorComponent}
      //       handleReplaceFile={handleReplaceFile}
      //       handleRemoveFile={handleRemoveFile}
      //     />
      //   );
      case ReviewStates.UPLOAD_SQL:
        return (
          <UploadFireSQL
            personnelRecording={personnelRecording}
            acceptedFiles={acceptedFiles}
            uploadForm={uploadForm}
            parsedData={parsedData}
            setReviewState={setReviewState}
            setIsDataUnsaved={setIsDataUnsaved}
            schema={currentSite.schemaName || ''}
            uploadCompleteMessage={uploadCompleteMessage}
            setUploadCompleteMessage={setUploadCompleteMessage}
            setUploadError={setUploadError}
            setErrorComponent={setErrorComponent}
            setAllRowToCMID={setAllRowToCMID}
            errorRows={errorRows}
            setErrorRows={setErrorRows}
          />
        );
      case ReviewStates.VALIDATE:
        return <UploadValidation setReviewState={setReviewState} schema={currentSite.schemaName || ''} />;
      case ReviewStates.UPDATE:
        return <UploadUpdateValidations setReviewState={setReviewState} schema={currentSite.schemaName || ''} />;
      case ReviewStates.UPLOAD_AZURE:
        return (
          <UploadFireAzure
            acceptedFiles={acceptedFiles}
            uploadForm={uploadForm}
            setReviewState={setReviewState}
            setIsDataUnsaved={setIsDataUnsaved}
            setUploadError={setUploadError}
            setErrorComponent={setErrorComponent}
            user={session?.user?.name ? session?.user?.name : ''}
            allRowToCMID={allRowToCMID}
          />
        );
      case ReviewStates.COMPLETE:
        return <UploadComplete handleCloseUploadModal={onReset} uploadForm={uploadForm} errorRows={errorRows} />;
      default:
        return (
          <UploadError
            error={uploadError}
            component={errorComponent}
            acceptedFiles={acceptedFiles}
            setAcceptedFiles={setAcceptedFiles}
            setReviewState={setReviewState}
            handleReturnToStart={handleReturnToStart}
            resetError={resetError}
          />
        );
    }
  };
  return (
    <>
      {currentCensus && currentPlot && (
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
      )}
    </>
  );
}
