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
import {DisplayParsedDataGridInline} from "@/components/uploadsystemhelpers/displayparseddatagrid";
import Divider from "@mui/joy/Divider";
import React, {useState} from "react";
import {RequiredTableHeadersByFormType, ReviewStates, UploadReviewFilesProps} from "@/config/macros";
import {FileWithPath} from "react-dropzone";
import {DropzoneLogic} from "@/components/uploadsystemhelpers/dropzone";
import {FileDisplay} from "@/components/uploadsystemhelpers/filelist";
import CircularProgress from "@mui/joy/CircularProgress";

export default function UploadReviewFiles(props: Readonly<UploadReviewFilesProps>) {
  const {
    uploadForm,
    acceptedFiles,
    setReviewState,
    expectedHeaders,
    parsedData,
    setParsedData,
    errorRows,
    setErrorRows,
    confirmationDialogOpen,
    errors,
    setErrors,
    setAcceptedFiles,
    dataViewActive,
    currentFileHeaders,
    setUploadError,
    setErrorComponent,
    handleChange,
    areHeadersValid,
    handleRemoveCurrentFile,
    handleApproval,
    handleCancel,
    handleConfirm,
    parseAndUpdateFile
  } = props;

  const [isReuploadDialogOpen, setIsReuploadDialogOpen] = useState(false);
  const [reuploadInProgress, setReuploadInProgress] = useState(false);
  const currentFileName = acceptedFiles[dataViewActive - 1]?.name;
  const hasErrors = errors[currentFileName] && Object.keys(errors[currentFileName]).length > 0;
  let requiredExpectedHeadersRaw = RequiredTableHeadersByFormType[uploadForm];
  const requiredHeadersTrimmed = requiredExpectedHeadersRaw.map(item => item.label);

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
  return (
    <>
      <Box sx={{display: 'flex', flex: 1, flexDirection: 'column'}}>
        {reuploadInProgress ? (
          <CircularProgress/>
        ) : (
          <>
            <Button variant="contained" onClick={() => setReviewState(ReviewStates.UPLOAD_FILES)}
                    sx={{mb: 2, width: 'fit-content'}}>
              Back
            </Button>
            <Grid container spacing={2}>
              <Grid item xs={4}/>
              <Grid item xs={4}>
                <Box sx={{display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'center'}}>
                  <Button variant="contained" color="primary" onClick={handleRemoveCurrentFile}
                          sx={{width: 'fit-content'}}>
                    Remove Current File
                  </Button>
                  <Box sx={{display: 'flex', flexDirection: 'row', mb: 2}}>
                    <Divider orientation={"vertical"} sx={{marginX: 2}}/>
                    {currentFileHeaders.length > 0 ? (
                      requiredHeadersTrimmed.map((header) => (
                        <Box key={header} sx={{display: 'flex', flex: 1, alignItems: 'center'}}>
                          <Checkbox
                            size={"lg"}
                            disabled
                            checked={currentFileHeaders.map(item => item.trim().toLowerCase()).includes(header.trim().toLowerCase())}
                            label={header}
                            color={"success"}/>
                          <Divider orientation={"vertical"} sx={{marginX: 2}}/>
                        </Box>
                      ))
                    ) : (
                      <Typography>No file selected or file has no headers.</Typography>
                    )}
                  </Box>
                  <FileDisplay acceptedFiles={acceptedFiles}/>
                </Box>
              </Grid>
              <Grid item xs={4}/>
              <Grid item xs={12}>
                <Box sx={{display: 'flex', flexDirection: 'column', mr: 10}}>
                  {acceptedFiles.length > 0 && acceptedFiles[dataViewActive - 1] && areHeadersValid(currentFileHeaders) ? (
                    <>
                      <Typography level={"title-md"} color={"primary"} sx={{marginBottom: 1}}>
                        Form: {uploadForm}
                      </Typography><Typography level={"title-sm"}>
                      File: {acceptedFiles[dataViewActive - 1].name}
                    </Typography>
                      <DisplayParsedDataGridInline
                        parsedData={parsedData}
                        errors={errors}
                        setErrors={setErrors}
                        setParsedData={setParsedData}
                        errorRows={errorRows}
                        setErrorRows={setErrorRows}
                        formType={uploadForm}
                        fileName={acceptedFiles[dataViewActive - 1].name}/>
                    </>
                  ) : (
                    <Typography level="body-lg" bgcolor="error">
                      The selected file is missing required headers. Please check the file and re-upload.<br/>
                      Your file&apos;s headers were: {currentFileHeaders.join(', ')}<br/>
                      The expected headers were {expectedHeaders.join(', ')}
                    </Typography>
                  )}
                </Box>
                <Pagination count={acceptedFiles.length} page={dataViewActive} onChange={handleChange}/>
                <Button
                  onClick={() => setIsReuploadDialogOpen(true)}
                  variant={"outlined"}
                  color="primary"
                  disabled={!hasErrors}
                  sx={{marginTop: 2}}
                >
                  Re-upload Corrected File
                </Button>
              </Grid>
              <Grid item xs={4}/>
              <Grid item xs={4}>
                <Box sx={{display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'center'}}>
                  <Button
                    variant={"contained"}
                    disabled={!areHeadersValid(currentFileHeaders)}
                    onClick={handleApproveClick} // Updated here
                    sx={{width: 'fit-content'}}
                  >
                    Confirm Changes
                  </Button>
                </Box>
              </Grid>
              <Grid item xs={4}/>
              <Modal open={isReuploadDialogOpen} onClose={() => setIsReuploadDialogOpen(false)}>
                <ModalDialog>
                  <DialogTitle>Re-upload Corrected File</DialogTitle>
                  <DialogContent>
                    <DialogContentText>
                      Please upload the corrected version of the file: {currentFileName}
                    </DialogContentText>
                    <DropzoneLogic onChange={handleReUploadFileChange}/>
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
            </Grid></>
        )}
      </Box>
    </>
  );
}