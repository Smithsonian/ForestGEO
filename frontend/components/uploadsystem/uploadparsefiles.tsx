"use client";
import {Box, DialogActions, DialogContent, DialogTitle, Modal, ModalDialog, Stack, Typography} from "@mui/joy";
import {ReviewStates, TableHeadersByFormType, UploadParseFilesProps} from "@/config/macros";
import {Button, Grid} from "@mui/material";
import {DropzoneLogic} from "@/components/uploadsystemhelpers/dropzone";
import {FileDisplay} from "@/components/uploadsystemhelpers/filelist";
import {LoadingButton} from "@mui/lab";
import React from "react";

export default function UploadParseFiles(props: Readonly<UploadParseFilesProps>) {
  const {
    uploadForm, personnelRecording, acceptedFiles,
    parsing, setReviewState,
    isOverwriteConfirmDialogOpen, setIsOverwriteConfirmDialogOpen,
    handleInitialSubmit, handleFileReplace, handleFileChange
  } = props;

  return (
    <Box sx={{display: 'flex', flex: 1, flexDirection: 'column'}}>
      <Button variant="contained" onClick={() => setReviewState(ReviewStates.START)} sx={{mb: 2}}>
        Back
      </Button>
      <Grid container spacing={2}>
        <Grid item xs={6} sx={{marginRight: 2}}>
          <Box sx={{display: 'flex', flexDirection: 'column', mb: 10, mr: 10}}>
            <DropzoneLogic onChange={handleFileChange}/>
            <Modal open={isOverwriteConfirmDialogOpen} onClose={() => setIsOverwriteConfirmDialogOpen(false)}>
              <ModalDialog>
                <DialogTitle>Confirm File Replace</DialogTitle>
                <DialogContent>
                  A file with the same name already exists. Do you want to replace it?
                </DialogContent>
                <DialogActions>
                  <Button onClick={() => setIsOverwriteConfirmDialogOpen(false)}>Cancel</Button>
                  <Button
                    onClick={() => {
                      // Replace the existing file with the new one
                      handleFileReplace();
                      setIsOverwriteConfirmDialogOpen(false);
                    }}
                  >
                    Replace
                  </Button>
                </DialogActions>
              </ModalDialog>
            </Modal>
          </Box>
        </Grid>
        <Grid item xs={6}>
          <Stack direction={"column"} sx={{display: 'flex', flexDirection: 'column', mb: 10}}>
            <Typography sx={{mb: 2}}>
              You have selected {uploadForm}. Please ensure that your file has the following headers before
              continuing: <br/>
              {uploadForm !== '' && TableHeadersByFormType[uploadForm]?.map(obj => obj.label).join(', ')} <br/>
              The person recording the data is {personnelRecording}. Please verify this before continuing.
            </Typography>
            <Box sx={{display: 'flex', flex: 1, justifyContent: 'center'}}>
              <FileDisplay acceptedFiles={acceptedFiles}/>
            </Box>
            <LoadingButton disabled={acceptedFiles.length <= 0} loading={parsing} onClick={handleInitialSubmit}>
              Review Files
            </LoadingButton>
          </Stack>
        </Grid>
      </Grid>
    </Box>
  );
}