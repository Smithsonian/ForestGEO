"use client";
import React, {useEffect, useState} from "react";
import {
  FileCollectionRowSet,
  FileRow,
  FileRowSet,
  RequiredTableHeadersByFormType,
  ReviewStates,
  TableHeadersByFormType
} from "@/config/macros";
import {FileWithPath} from "react-dropzone";
import {useCensusContext, usePlotContext} from "@/app/contexts/userselectionprovider";
import {useSession} from "next-auth/react";
import {parse, ParseResult} from "papaparse";
import {Box, Tab, TabList, TabPanel, Tabs, Typography} from "@mui/joy";
import UploadParseFiles from "@/components/uploadsystem/uploadparsefiles";
import UploadReviewFiles from "@/components/uploadsystem/uploadreviewfiles";
import UploadFire from "@/components/uploadsystem/uploadfire";
import UploadError from "@/components/uploadsystem/uploaderror";
import ViewUploadedFiles from "../fileupload/viewuploadedfiles";

export function fileCollectionToString(fileCollection: FileCollectionRowSet): string {
  let result = '';

  for (const filename in fileCollection) {
    const fileRowSet = fileCollection[filename];

    for (const row in fileRowSet) {
      const fileRow = fileRowSet[row];

      for (const header in fileRow) {
        const value = fileRow[header];
        result += `${filename},${row},${header},${value}|`;
      }
    }
  }

  // Remove the trailing '|' character if needed
  if (result.length > 0) {
    result = result.slice(0, -1);
  }

  return result;
}

export function fileRowSetToString(fileRowSet: FileRowSet): string {
  let result = '';

  for (const row in fileRowSet) {
    result += `Row: ${row} { `;
    const fileRow = fileRowSet[row];

    for (const header in fileRow) {
      const value = fileRow[header];
      result += `${header}: ${value}, `;
    }

    // Remove the trailing ', ' characters if needed
    if (result.endsWith(', ')) {
      result = result.slice(0, -2);
    }

    result += ' }, ';
  }

  // Remove the trailing ', ' characters if needed
  if (result.endsWith(', ')) {
    result = result.slice(0, -2);
  }

  return result;
}

export default function UploadParent() {
  /**
   * this will be the new parent upload function that will then pass data to child components being called within
   */
    // select schema table that file should be uploaded to --> state
  const [uploadForm, setUploadForm] = useState("");
  // in progress state --> data is being parsed
  const [parsing, setParsing] = useState(false);
  // core enum to handle state progression
  const [reviewState, setReviewState] = useState<ReviewStates>(ReviewStates.PARSE);
  // dropped file storage
  const [acceptedFiles, setAcceptedFiles] = useState<FileWithPath[]>([]);
  // pagination counter to manage validation table view/allow scroll through files in REVIEW
  const [dataViewActive, setDataViewActive] = useState(1);
  // for REVIEW --> storage of parsed data for display
  const [parsedData, setParsedData] = useState<FileCollectionRowSet>({});
  const [errorRows, setErrorRows] = useState<FileCollectionRowSet>({});
  const [errors, setErrors] = useState<FileCollectionRowSet>({});
  // Confirmation menu states:
  const [confirmationDialogOpen, setConfirmationDialogOpen] = React.useState(false);
  const [currentFileHeaders, setCurrentFileHeaders] = useState<string[]>([]);
  const [expectedHeaders, setExpectedHeaders] = useState<string[]>([]);
  const [uploadCompleteMessage, setUploadCompleteMessage] = useState("");
  const [allFileHeaders, setAllFileHeaders] = useState<{ [key: string]: string[] }>({});
  const [isOverwriteConfirmDialogOpen, setIsOverwriteConfirmDialogOpen] = useState(false);
  const [fileToOverwrite, setFileToOverwrite] = useState<FileWithPath | null>(null);
  const [isDataUnsaved, setIsDataUnsaved] = useState(false);
  const [uploadError, setUploadError] = useState<any>();
  const [errorComponent, setErrorComponent] = useState('');
  let currentPlot = usePlotContext();
  let currentCensus = useCensusContext();
  const {data: session} = useSession();
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

  function areHeadersValid(actualHeaders: string[]): boolean {
    const expectedHeadersLower = expectedHeaders.map(header => header.toLowerCase());
    const actualHeadersLower = actualHeaders.map(header => header.toLowerCase());

    const allExpectedHeadersPresent = expectedHeadersLower.every(expectedHeader =>
      actualHeadersLower.includes(expectedHeader));

    const noAdditionalHeaders = actualHeadersLower.every(actualHeader =>
      expectedHeadersLower.includes(actualHeader));

    return allExpectedHeadersPresent && noAdditionalHeaders;
  }

  async function handleReturnToStart() {
    setDataViewActive(1);
    setAcceptedFiles([]);
    setParsedData({});
    setErrors({})
    setErrorRows({});
    setUploadForm('');
  }

  async function resetError() {
    setUploadError(null);
    setErrorComponent('');
  }

  async function handleApproval() {
    setConfirmationDialogOpen(true);
  }

  async function handleCancel() {
    setConfirmationDialogOpen(false);
  }

  async function handleConfirm() {
    setConfirmationDialogOpen(false);
    setReviewState(ReviewStates.UPLOAD);
  }

  const handleChange = (_event: React.ChangeEvent<unknown>, value: number) => {
    setDataViewActive(value);
  };

  const handleRemoveCurrentFile = () => {
    try {
      setAcceptedFiles(prevFiles => {
        // Find the index of the current file being viewed
        const fileIndex = dataViewActive - 1;

        // Remove the file at the current index
        const updatedFiles = prevFiles.filter((_, index) => index !== fileIndex);

        // Adjust the current page if necessary
        if (dataViewActive > updatedFiles.length) {
          setDataViewActive(updatedFiles.length);
        } else if (dataViewActive > 1 && fileIndex === prevFiles.length - 1) {
          // If the last file in the list was removed, decrement the dataViewActive counter
          setDataViewActive(dataViewActive - 1);
        }
        return updatedFiles;
      });
    } catch (error: any) {
      const errorWithFile = {
        message: error.message, // original error message
        file: acceptedFiles[dataViewActive - 1].name, // include the name of the file that caused the error
        originalError: error // include the original error object if needed
      };
      setUploadError(errorWithFile);
      setErrorComponent('UploadReviewFiles');
      setReviewState(ReviewStates.ERRORS);
    }
  };

  const handleFileReplace = () => {
    if (fileToOverwrite) {
      try {
        setAcceptedFiles((prevFiles) => {
          // Filter out the existing file with the same name
          const filteredFiles = prevFiles.filter(file => file.name !== fileToOverwrite.name);
          // Add the new file
          return [...filteredFiles, fileToOverwrite];
        });
        // Reset the pending file
        setFileToOverwrite(null);
      } catch (error: any) {
        const errorWithFile = {
          message: error.message, // original error message
          file: fileToOverwrite.name, // include the name of the file that caused the error
          originalError: error // include the original error object if needed
        };
        setUploadError(errorWithFile);
        setErrorComponent('UploadParseFiles');
        setReviewState(ReviewStates.ERRORS);
      }
    }
  };
  // Handle file changes from the Dropzone
  const handleFileChange = (newFiles: FileWithPath[]) => {
    // Check if there is an existing file with the same name

    newFiles.forEach(file => {
      try {
        const existingFile = acceptedFiles.find(f => f.name === file.name);
        if (existingFile) {
          // Prompt the user to confirm the file replace
          setFileToOverwrite(file);
          setIsOverwriteConfirmDialogOpen(true);
        } else {
          // No duplicate found, add the file normally
          setAcceptedFiles(prevFiles => [...prevFiles, file]);
        }
      } catch (error: any) {
        const errorWithFile = {
          message: error.message, // original error message
          file: file.name, // include the name of the file that caused the error
          originalError: error // include the original error object if needed
        };
        setUploadError(errorWithFile);
        setErrorComponent('UploadParseFiles');
        setReviewState(ReviewStates.ERRORS);
      }
    });
  };

  async function handleInitialSubmit() {
    setParsing(true);
    let collectFileHeaders = {...allFileHeaders};

    for (const file of acceptedFiles) {
      try {
        const fileText = await file.text();
        parse(fileText, {
          delimiter: ",",
          header: true,
          skipEmptyLines: true,
          transformHeader: (h) => h.trim(),
          complete: function (results: ParseResult<any>) {
            const expectedHeaders = TableHeadersByFormType[uploadForm];
            const requiredHeaders = RequiredTableHeadersByFormType[uploadForm];

            if (!expectedHeaders || !requiredHeaders) {
              console.error(`No headers defined for form type: ${uploadForm}`);
              setReviewState(ReviewStates.FILE_MISMATCH_ERROR);
              return;
            }

            collectFileHeaders[file.name] = results.meta.fields!;

            let fileErrors: FileRowSet = {};

            results.data.forEach((row, index) => {
              const typedRow = row as FileRow;
              let rowErrors: FileRow = {};
              let hasError = false;

              requiredHeaders.forEach((header) => {
                const value = typedRow[header.label];
                if (value === null || value === undefined || value === "" || value === "NULL") {
                  rowErrors[header.label] = "This field is required";
                  hasError = true;
                }
              });

              let dbhValue = parseFloat(typedRow["DBH"]);
              if (!isNaN(dbhValue) && dbhValue < 1) {
                rowErrors["DBH"] = "DBH must be a number greater than 1";
                hasError = true;
              }
              dbhValue = parseFloat(typedRow['dbh']);
              if (!isNaN(dbhValue) && dbhValue < 1) {
                rowErrors["dbh"] = "DBH must be a number greater than 1";
                hasError = true;
              }

              if (hasError) {
                fileErrors[`row-${index}`] = rowErrors;
                setErrorRows(prevErrorRows => ({
                  ...prevErrorRows,
                  [file.name]: {...prevErrorRows[file.name], [`row-${index}`]: typedRow}
                }));
              }

              setParsedData(prevParsedData => ({
                ...prevParsedData,
                [file.name]: {...prevParsedData[file.name], [`row-${index}`]: typedRow}
              }));
            });

            if (results.errors.length) {
              results.errors.forEach((error) => {
                const errorKey = typeof error.row === 'number' ? `row-${error.row}` : 'file-level-error';
                fileErrors[errorKey] = {"_error": error.message};
              });
            }

            setErrors(prevErrors => ({
              ...prevErrors,
              [file.name]: fileErrors
            }));
          },
        });
      } catch (error: any) {
        const errorWithFile = {
          message: error.message, // original error message
          file: file.name, // include the name of the file that caused the error
          originalError: error // include the original error object if needed
        };
        setUploadError(errorWithFile);
        setErrorComponent('UploadParseFiles');
        setReviewState(ReviewStates.ERRORS);
      }
    }
    setAllFileHeaders(collectFileHeaders);
    setReviewState(ReviewStates.REVIEW);
    setParsing(false);
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
    if (acceptedFiles.length === 0 && reviewState === ReviewStates.REVIEW) setReviewState(ReviewStates.PARSE); // if the user removes all files, move back to file drop phase

  }, [reviewState, dataViewActive, acceptedFiles, setCurrentFileHeaders, allFileHeaders]);

  const renderStateContent = () => {
    switch (reviewState) {
      case ReviewStates.PARSE:
        return <UploadParseFiles
          parsing={parsing}
          uploadForm={uploadForm}
          acceptedFiles={acceptedFiles}
          setExpectedHeaders={setExpectedHeaders}
          setUploadForm={setUploadForm}
          setAcceptedFiles={setAcceptedFiles}
          isOverwriteConfirmDialogOpen={isOverwriteConfirmDialogOpen}
          setIsOverwriteConfirmDialogOpen={setIsOverwriteConfirmDialogOpen}
          handleFileChange={handleFileChange}
          handleInitialSubmit={handleInitialSubmit}
          handleFileReplace={handleFileReplace}
          setUploadError={setUploadError}
          setErrorComponent={setErrorComponent}/>;
      case ReviewStates.REVIEW:
        return <UploadReviewFiles
          acceptedFiles={acceptedFiles}
          setAcceptedFiles={setAcceptedFiles}
          uploadForm={uploadForm}
          errors={errors}
          errorRows={errorRows}
          parsedData={parsedData}
          expectedHeaders={expectedHeaders}
          currentFileHeaders={currentFileHeaders}
          dataViewActive={dataViewActive}
          areHeadersValid={areHeadersValid}
          setErrors={setErrors}
          setErrorRows={setErrorRows}
          setReviewState={setReviewState}
          confirmationDialogOpen={confirmationDialogOpen}
          setParsedData={setParsedData}
          handleConfirm={handleConfirm}
          handleRemoveCurrentFile={handleRemoveCurrentFile}
          handleCancel={handleCancel}
          handleApproval={handleApproval}
          handleChange={handleChange}
          setUploadError={setUploadError}
          setErrorComponent={setErrorComponent}
        />;
      case ReviewStates.UPLOAD:
        return <UploadFire
          acceptedFiles={acceptedFiles}
          setAcceptedFiles={setAcceptedFiles}
          uploadForm={uploadForm}
          errors={errors}
          errorRows={errorRows}
          parsedData={parsedData}
          expectedHeaders={expectedHeaders}
          currentFileHeaders={currentFileHeaders}
          dataViewActive={dataViewActive}
          areHeadersValid={areHeadersValid}
          setErrors={setErrors}
          setErrorRows={setErrorRows}
          setReviewState={setReviewState}
          confirmationDialogOpen={confirmationDialogOpen}
          setParsedData={setParsedData}
          handleConfirm={handleConfirm}
          handleRemoveCurrentFile={handleRemoveCurrentFile}
          handleCancel={handleCancel}
          handleApproval={handleApproval}
          handleChange={handleChange}
          setIsDataUnsaved={setIsDataUnsaved}
          currentPlot={currentPlot!}
          currentCensus={currentCensus!}
          user={session?.user?.name!}
          uploadCompleteMessage={uploadCompleteMessage}
          setUploadCompleteMessage={setUploadCompleteMessage}
          handleReturnToStart={handleReturnToStart}
          setUploadError={setUploadError}
          setErrorComponent={setErrorComponent}
        />;
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
  }
  return (
    <Box sx={{display: 'flex', width: '100%', flexDirection: 'column', marginBottom: 5}}>
      <Typography level={"title-lg"} color={"primary"}>
        Drag and drop files into the box to upload them to storage
      </Typography>
      <Box sx={{mt: 5, mr: 5, width: '95%'}}>
        <Tabs sx={{display: 'flex', flex: 1}} aria-label={"File Hub Options"} size={"lg"} className={""}>
          <TabList sticky={"top"}>
            <Tab>Browse Uploaded Files</Tab>
            <Tab>Upload New Files</Tab>
          </TabList>
          <TabPanel value={0}>
            <ViewUploadedFiles currentPlot={currentPlot} currentCensus={currentCensus}/>
          </TabPanel>
          <TabPanel value={1}>
            {currentPlot ? renderStateContent() : <Typography>You must select a plot to continue!</Typography>}
          </TabPanel>
        </Tabs>
      </Box>
    </Box>
  );
}