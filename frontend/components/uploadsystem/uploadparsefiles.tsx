"use client";
import { Alert, Box, DialogActions, DialogContent, DialogTitle, Modal, ModalDialog, Stack, Tooltip, Typography } from "@mui/joy";
import { TableHeadersByFormType, UploadParseFilesProps } from "@/config/macros";
import { Button, Grid } from "@mui/material";
import { DropzoneLogic } from "@/components/uploadsystemhelpers/dropzone";
import { FileList } from "@/components/uploadsystemhelpers/filelist";
import { LoadingButton } from "@mui/lab";
import React, { useState } from "react";
import { FileWithPath } from "react-dropzone";
import WarningIcon from "@mui/icons-material/Warning";

export default function UploadParseFiles(props: Readonly<UploadParseFilesProps>) {
  const {
    uploadForm, personnelRecording, acceptedFiles,
    dataViewActive, setDataViewActive,
    parseFile, handleInitialSubmit, handleAddFile, handleReplaceFile, handleRemoveFile,
  } = props;

  const [fileToReplace, setFileToReplace] = useState<FileWithPath | null>(null);

  const handleFileChange = async (newFiles: FileWithPath[]) => {
    for (const file of newFiles) {
      const existingFile = acceptedFiles.find(f => f.name === file.name);
      if (existingFile) {
        setFileToReplace(file);
      } else {
        await parseFile(file); // parse the file
        handleAddFile(file);
      }
    }
  };

  return (
    <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
      <Grid container>
        <Grid item xs={6}>
          <Box sx={{ display: 'flex', flexDirection: 'column', mb: 10, mr: 10 }}>
            <DropzoneLogic onChange={handleFileChange} />
            <Modal open={Boolean(fileToReplace)}
              onClose={() => setFileToReplace(null)}>
              <ModalDialog>
                <DialogTitle>Confirm File Replace</DialogTitle>
                <DialogContent>
                  A file with the same name already exists. Do you want to replace it?
                </DialogContent>
                <DialogActions>
                  <Button onClick={() => setFileToReplace(null)}>Cancel</Button>
                  <Button
                    onClick={async () => {
                      if (fileToReplace) {
                        const index = acceptedFiles.findIndex(f => f.name === fileToReplace.name);
                        handleReplaceFile(index, fileToReplace);
                        await props.parseFile(fileToReplace); // Parse the replaced file
                      }
                      setFileToReplace(null);
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
          <Stack direction={"column"} sx={{ display: 'flex', flexDirection: 'column', mb: 10 }}>
            <Typography sx={{ mb: 2 }}>
              You have selected {uploadForm}. Please ensure that your file has the following headers
              before continuing: <br />
              {uploadForm !== '' && TableHeadersByFormType[uploadForm]?.map(obj => obj.label).join(', ')}
              <br />
            </Typography>

            {uploadForm === 'measurements' && (
              <>
                <Alert
                  startDecorator={<WarningIcon fontSize="inherit" />}
                  variant="solid"
                  color="danger"
                  sx={{ mb: 2 }}
                >
                  <Typography>
                    Please note: For date fields, accepted formats are <br />
                    <Tooltip title="Year-Month-Day. Separators can be '-', '.' or '/'">
                      <strong>YYYY(-|.|/)MM(-|.|/)DD</strong>
                    </Tooltip> and
                    <Tooltip title="Day-Month-Year. Separators can be '-', '.' or '/'">
                      <strong>DD(-|.|/)MM(-|.|/)YYYY</strong>
                    </Tooltip>. <br />
                    Ensure your dates follow one of these formats.
                  </Typography>
                </Alert>
                <Typography sx={{ mb: 2 }}>
                  The person recording the data is {personnelRecording}.
                </Typography>
              </>
            )}
            <Box sx={{ display: 'flex', flex: 1, justifyContent: 'center' }}>
              <FileList acceptedFiles={acceptedFiles} dataViewActive={dataViewActive}
                setDataViewActive={setDataViewActive} />
              {acceptedFiles.length > 0 &&
                <Button
                  variant="outlined"
                  onClick={() => handleRemoveFile(dataViewActive - 1)}
                  sx={{ mt: 2 }}
                >
                  Delete Selected File
                </Button>
              }
            </Box>
            <LoadingButton disabled={acceptedFiles.length <= 0}
              onClick={handleInitialSubmit}>
              Review Files
            </LoadingButton>
          </Stack>
        </Grid>
      </Grid>
    </Box>
  );
}