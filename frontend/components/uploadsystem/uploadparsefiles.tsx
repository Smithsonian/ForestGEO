"use client";
import {Box, DialogActions, DialogContent, DialogTitle, Modal, ModalDialog, Stack, Typography} from "@mui/joy";
import {TableHeadersByFormType, UploadParseFilesProps} from "@/config/macros";
import SelectFormType from "@/components/fileupload/groupedformselection";
import {Button, Grid} from "@mui/material";
import {DropzoneLogic} from "@/components/fileupload/dropzone";
import {FileWithPath} from "react-dropzone";
import Divider from "@mui/joy/Divider";
import {FileDisplay} from "@/components/fileupload/filelist";
import {LoadingButton} from "@mui/lab";
import React from "react";

export default function UploadParseFiles(props: Readonly<UploadParseFilesProps>) {
  const {
    uploadForm, setUploadForm, acceptedFiles,
    setExpectedHeaders, parsing,
    isOverwriteConfirmDialogOpen, setIsOverwriteConfirmDialogOpen,
    handleInitialSubmit, handleFileReplace, handleFileChange
  } = props;

  return (
    <Box sx={{display: 'flex', flex: 1, flexDirection: 'column'}}>
      {!TableHeadersByFormType.hasOwnProperty(uploadForm) ? <Stack direction={"column"} sx={{width: 'fit-content'}}>
        <Typography sx={{mb: 2}}>
          Your file will need the correct headers in order to be uploaded to your intended table
          destination.<br/> Please review the table header requirements before continuing:
        </Typography>
        <Box sx={{display: 'flex', width: 'fit-content', justifyContent: 'center', mb: 1}}>
          <SelectFormType
            externalState={uploadForm}
            updateExternalState={setUploadForm}
            updateExternalHeaders={setExpectedHeaders}
          />
        </Box>
      </Stack> : <Stack direction={"column"} sx={{width: 'fit-content'}}>
        <Button onClick={() => setUploadForm('')} sx={{width: 'fit-content'}}>
          Return to Table Select
        </Button>
        <Typography sx={{mb: 2}}>
          You have selected {uploadForm}. Please ensure that your file has the following headers before continuing:
        </Typography>
        <Typography>
          {uploadForm !== '' && TableHeadersByFormType[uploadForm]?.map(obj => obj.label).join(', ')}
        </Typography>
      </Stack>}
      {TableHeadersByFormType.hasOwnProperty(uploadForm) && <Grid container spacing={2}>
        <Grid item xs={5}>
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

        <Grid item xs={2}>
          <Divider orientation="vertical" sx={{mx: 4}}/>
        </Grid>

        <Grid item xs={5}>
          <Stack direction={"column"} sx={{display: 'flex', flexDirection: 'column', mb: 10}}>
            <Box sx={{display: 'flex', flex: 1, justifyContent: 'center'}}>
              <FileDisplay acceptedFiles={acceptedFiles}/>
            </Box>
            <LoadingButton disabled={acceptedFiles.length <= 0} loading={parsing} onClick={handleInitialSubmit}>
              Review Files
            </LoadingButton>
          </Stack>
        </Grid>
      </Grid>}
    </Box>
  );
}