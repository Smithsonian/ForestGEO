"use client";

import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Grid,
  Pagination
} from "@mui/material";
import {Box, Checkbox, Modal, ModalDialog, Stack, Typography} from "@mui/joy";
import {DisplayParsedDataGrid} from "@/components/fileupload/validationtable";
import Divider from "@mui/joy/Divider";
import React, {useState} from "react";
import {
  FileRow,
  FileRowSet,
  RequiredTableHeadersByFormType,
  ReviewStates,
  TableHeadersByFormType,
  UploadReviewFilesProps
} from "@/config/macros";
import {FileWithPath} from "react-dropzone";
import {DropzoneLogic} from "@/components/fileupload/dropzone";
import {parse, ParseResult} from "papaparse";

export default function UploadReviewFiles(props: Readonly<UploadReviewFilesProps>) {
  const {
    uploadForm, acceptedFiles, setReviewState,
    expectedHeaders, parsedData, setParsedData,
    errorRows, setErrorRows, confirmationDialogOpen,
    errors, setErrors, setAcceptedFiles,
    dataViewActive, currentFileHeaders, setUploadError, setErrorComponent,
    handleChange, areHeadersValid, handleRemoveCurrentFile, handleApproval, handleCancel, handleConfirm
  } = props;

  const [isReuploadDialogOpen, setIsReuploadDialogOpen] = useState(false);
  const [reuploadInProgress, setReuploadInProgress] = useState(false);
  const currentFileName = acceptedFiles[dataViewActive - 1]?.name;
  const hasErrors = errors[currentFileName] && Object.keys(errors[currentFileName]).length > 0;

  const allHeadersPresent = expectedHeaders.every(header =>
    currentFileHeaders.includes(header.trim().toLowerCase())
  );

  const parseAndUpdateFile = async (file: FileWithPath) => {
    try {
      const fileText = await file.text();
      parse<FileRow>(fileText, {
        delimiter: ",",
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim(),
        complete: function (results: ParseResult<FileRow>) {
          const expectedHeaders = TableHeadersByFormType[uploadForm];
          const requiredHeaders = RequiredTableHeadersByFormType[uploadForm];

          if (!expectedHeaders || !requiredHeaders) {
            console.error(`No headers defined for form type: ${uploadForm}`);
            setReviewState(ReviewStates.FILE_MISMATCH_ERROR);
            return;
          }

          const updatedFileRowSet: FileRowSet = {};
          let fileErrors: FileRowSet = {};

          results.data.forEach((row, index) => {
            const rowId = `row-${index}`;
            updatedFileRowSet[rowId] = row;

            let rowErrors: FileRow = {};
            let hasError = false;

            requiredHeaders.forEach((header) => {
              const value = row[header.label];
              if (value === null || value === undefined || value === "") {
                rowErrors[header.label] = "This field is required";
                hasError = true;
              }
            });

            // Additional validation logic (similar to the original code)
            //...

            if (hasError) {
              fileErrors[rowId] = rowErrors;
            }
          });

          // Update state with the new parsed data
          setParsedData(prevParsedData => ({
            ...prevParsedData,
            [file.name]: updatedFileRowSet,
          }));

          // Update errorRows with the new parsed data (if any errors)
          setErrorRows(prevErrorRows => ({
            ...prevErrorRows,
            [file.name]: updatedFileRowSet,
          }));

          // Update errors with the new parsed errors (if any)
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
      setErrorComponent('UploadReviewFiles');
      setReviewState(ReviewStates.ERRORS);
    }
  };

  const handleReUploadFileChange = async (newFiles: FileWithPath[]) => {
    setReuploadInProgress(true);
    const newFile = newFiles[0];
    if (newFile.name !== currentFileName) {
      alert("Please upload a corrected version of the current file.");
      setIsReuploadDialogOpen(false);
      return;
    }

    // Replace the file, re-parse and validate
    setAcceptedFiles(prevFiles => {
      const updatedFiles = [...prevFiles];
      updatedFiles[dataViewActive - 1] = newFile;
      return updatedFiles;
    });
    // Similar to the parse logic in UploadParent, re-parse the file
    // You need to define a function similar to parseFileText in UploadParent
    // for parsing and updating parsedData, errorRows, and errors
    await parseAndUpdateFile(newFile);
    setReuploadInProgress(false);
    setIsReuploadDialogOpen(false);
  };

  const canConfirmChanges = acceptedFiles.every(file => {
    const fileName = file.name;
    return !errors[fileName] || Object.keys(errors[fileName]).length === 0;
  });


  const areAllErrorsResolved = (fileName: string): boolean => {
    // Check if there are no errors left for the current file
    return (!errors[fileName] || Object.keys(errors[fileName]).length === 0) ||
      (!errorRows[fileName] || Object.keys(errorRows[fileName]).length === 0);
  };

  const handleApproveClick = async () => {
    if (areAllErrorsResolved(acceptedFiles[dataViewActive - 1]?.name)) {
      try {
        await handleApproval();
      } catch (error) {
        console.error('Error during approval:', error);
        setUploadError(error);
        setErrorComponent('UploadReviewFiles');
        setReviewState(ReviewStates.ERRORS);
        // Optionally, handle the error in the UI, such as displaying an error message
      }
    } else {
      alert('Please resolve all errors before proceeding.');
    }
  };

  const handleBack = () => {
    // Set the review state to PARSE to go back to the UploadParseFiles component
    setReviewState(ReviewStates.PARSE);
  };

  return (
    <Grid container spacing={2}>
      <Grid item xs={5}>
        <Button variant="contained" onClick={handleBack} sx={{mb: 2}}>
          Back
        </Button>
        <Box sx={{display: 'flex', flexDirection: 'column', mb: 10, mr: 10}}>
          {acceptedFiles.length > 0 && acceptedFiles[dataViewActive - 1] && allHeadersPresent ? (
            <DisplayParsedDataGrid
              parsedData={parsedData}
              errors={errors}
              setErrors={setErrors}
              setParsedData={setParsedData}
              errorRows={errorRows}
              setErrorRows={setErrorRows}
              formType={uploadForm}
              fileName={acceptedFiles[dataViewActive - 1].name}
            />
          ) : (
            <Typography level="body-lg" bgcolor="error">
              The selected file is missing required headers. Please check the file and re-upload.
            </Typography>
          )}
          <Button
            onClick={() => setIsReuploadDialogOpen(true)}
            variant="contained"
            color="primary"
            disabled={!hasErrors}
            sx={{ marginTop: 2 }}
          >
            Re-upload Corrected File
          </Button>
        </Box>
        <Pagination count={acceptedFiles.length} page={dataViewActive} onChange={handleChange}/>
      </Grid>

      <Grid item xs={2}>
        <Divider orientation="vertical" sx={{my: 4}}/>
      </Grid>

      <Grid item xs={5}>
        <Button variant="contained" color="primary" onClick={handleRemoveCurrentFile} sx={{width: 'fit-content'}}>
          Remove Current File
        </Button>
        <Box sx={{display: 'flex', flexDirection: 'column', mb: 10}}>
          <Divider orientation={"horizontal"}/>
          {currentFileHeaders.length > 0 ? (
            expectedHeaders.map((header) => (
              <Checkbox
                size={"lg"}
                key={header}
                disabled
                checked={currentFileHeaders.map(item => item.trim().toLowerCase()).includes(header.trim().toLowerCase())}
                label={header}
                color={"success"}
              />
            ))
          ) : (
            <Typography>No file selected or file has no headers.</Typography>
          )}
        </Box>
        <Button
          variant={"contained"}
          disabled={!areHeadersValid(currentFileHeaders)}
          onClick={handleApproveClick} // Updated here
          sx={{width: 'fit-content'}}
        >
          Confirm Changes
        </Button>
      </Grid>
      <Modal open={isReuploadDialogOpen} onClose={() => setIsReuploadDialogOpen(false)}>
        <ModalDialog>
          <DialogTitle>Re-upload Corrected File</DialogTitle>
          <DialogContent>
            <DialogContentText>
              Please upload the corrected version of the file: {currentFileName}
            </DialogContentText>
            <DropzoneLogic onChange={handleReUploadFileChange} />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setIsReuploadDialogOpen(false)}>Close</Button>
          </DialogActions>
        </ModalDialog>
      </Modal>
      <Dialog
        open={confirmationDialogOpen && canConfirmChanges}
        onClose={handleCancel}
        aria-labelledby="alert-dialog-title"
        aria-describedby="alert-dialog-description"
      >
        <DialogTitle id="alert-dialog-title">
          {"Do your files look correct?"}
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="alert-dialog-description">
            Please press Confirm to upload your files to storage.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Stack direction={"row"}>
            <Button onClick={handleCancel}>Cancel</Button>
            <Button onClick={handleConfirm} autoFocus>
              Confirm
            </Button>
          </Stack>
        </DialogActions>
      </Dialog>
    </Grid>
  );
}