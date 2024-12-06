'use client';
import { Alert, Box, DialogActions, DialogContent, DialogTitle, List, ListItem, Modal, ModalDialog, Stack, Tooltip, Typography } from '@mui/joy';
import { UploadParseFilesProps } from '@/config/macros/uploadsystemmacros';
import { getTableHeaders } from '@/config/macros/formdetails';
import { Button } from '@mui/material';
import Grid from '@mui/material/Grid2';
import { DropzoneLogic } from '@/components/uploadsystemhelpers/dropzone';
import { FileList } from '@/components/uploadsystemhelpers/filelist';
import { LoadingButton } from '@mui/lab';
import React, { useState } from 'react';
import { FileWithPath } from 'react-dropzone';
import WarningIcon from '@mui/icons-material/Warning';
import { usePlotContext } from '@/app/contexts/userselectionprovider';

export default function UploadParseFiles(props: Readonly<UploadParseFilesProps>) {
  const {
    uploadForm,
    personnelRecording,
    acceptedFiles,
    dataViewActive,
    setDataViewActive,
    parseFullFile,
    handleInitialSubmit,
    handleAddFile,
    handleReplaceFile,
    handleRemoveFile
  } = props;

  const [fileToReplace, setFileToReplace] = useState<FileWithPath | null>(null);
  const currentPlot = usePlotContext();

  const handleFileChange = async (newFiles: FileWithPath[]) => {
    for (const file of newFiles) {
      const existingFile = acceptedFiles.find(f => f.name === file.name);
      if (existingFile) {
        setFileToReplace(file);
      } else {
        handleAddFile(file);
        // await parseFullFile(file); // parse the file
      }
    }
  };

  return (
    <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
      <Grid container spacing={2}>
        <Grid size={6}>
          <Box sx={{ display: 'flex', flexDirection: 'column', mb: 10, mr: 10 }}>
            <DropzoneLogic onChange={handleFileChange} />
            <Modal open={Boolean(fileToReplace)} onClose={() => setFileToReplace(null)}>
              <ModalDialog>
                <DialogTitle>Confirm File Replace</DialogTitle>
                <DialogContent>A file with the same name already exists. Do you want to replace it?</DialogContent>
                <DialogActions>
                  <Button onClick={() => setFileToReplace(null)}>Cancel</Button>
                  <Button
                    onClick={async () => {
                      if (fileToReplace) {
                        const index = acceptedFiles.findIndex(f => f.name === fileToReplace.name);
                        handleReplaceFile(index, fileToReplace);
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
        <Grid size={6}>
          <Stack direction={'column'} sx={{ display: 'flex', flexDirection: 'column', mb: 10 }}>
            <Typography sx={{ mb: 2 }}>
              You have selected {uploadForm}. Please ensure that your file has the following headers before continuing: <br />
              {uploadForm !== undefined &&
                getTableHeaders(uploadForm, currentPlot?.usesSubquadrats ?? false)
                  .map(obj => obj.label)
                  .join(', ')}
              <br />
            </Typography>
            {uploadForm === 'measurements' && (
              <>
                <Alert startDecorator={<WarningIcon fontSize="large" />} variant="soft" color="danger" sx={{ mb: 2 }}>
                  <Typography component={'div'}>
                    Please note: For date fields, accepted formats are
                    <List marker="decimal">
                      <ListItem>
                        <Tooltip size="lg" title="Accepted separators: '-' (dash), '.' (period) or '/' (forward-slash)">
                          <Typography color="primary">YYYY-MM-DD</Typography>
                        </Tooltip>
                      </ListItem>
                      <ListItem>
                        <Tooltip size="lg" title="Accepted separators: '-' (dash), '.' (period) or '/' (forward-slash)">
                          <Typography color="primary">DD-MM-YYYY</Typography>
                        </Tooltip>
                      </ListItem>
                    </List>
                    Hover over formats to see additionally accepted separators.
                    <br />
                    Please ensure your dates follow one of these formats.
                  </Typography>
                </Alert>
                <Typography sx={{ mb: 2 }}>The person recording the data is {personnelRecording}.</Typography>
              </>
            )}
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                mt: 2
              }}
            >
              <FileList acceptedFiles={acceptedFiles} dataViewActive={dataViewActive} setDataViewActive={setDataViewActive} />
              {acceptedFiles.length > 0 && (
                <Button variant="contained" color="error" onClick={() => handleRemoveFile(dataViewActive - 1)} sx={{ mt: 2, alignSelf: 'center' }}>
                  Delete Selected File
                </Button>
              )}
            </Box>
            <LoadingButton variant="contained" color="primary" disabled={acceptedFiles.length <= 0} onClick={handleInitialSubmit} sx={{ mt: 2 }}>
              Review Files
            </LoadingButton>
          </Stack>
        </Grid>
      </Grid>
    </Box>
  );
}
