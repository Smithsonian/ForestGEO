'use client';
import { Box, Chip, DialogActions, DialogContent, DialogTitle, Modal, ModalDialog, Stack, Typography } from '@mui/joy';
import { UploadParseFilesProps } from '@/config/macros/uploadsystemmacros';
import { Button } from '@mui/material';
import Grid from '@mui/material/Grid2';
import { DropzoneLogic } from '@/components/uploadsystemhelpers/dropzone';
import { FileList } from '@/components/uploadsystemhelpers/filelist';
import { LoadingButton } from '@mui/lab';
import React, { useState } from 'react';
import { FileWithPath } from 'react-dropzone';
import RenderFormExplanations from '@/components/client/renderformexplanations';

export default function UploadParseFiles(props: Readonly<UploadParseFilesProps>) {
  const { uploadForm, acceptedFiles, dataViewActive, setDataViewActive, handleInitialSubmit, handleAddFile, handleReplaceFile, handleRemoveFile } = props;

  const [fileToReplace, setFileToReplace] = useState<FileWithPath | null>(null);

  const handleFileChange = async (newFiles: FileWithPath[]) => {
    for (const file of newFiles) {
      const existingFile = acceptedFiles.find(f => f.name === file.name);
      if (existingFile) {
        setFileToReplace(file);
      } else {
        handleAddFile(file);
      }
    }
  };

  return (
    <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
      <Stack direction={'column'} sx={{ display: 'flex', flexDirection: 'column', mb: 10 }}>
        <Typography>You have selected {uploadForm}. Please ensure that your file has the following headers (in any order) before continuing.</Typography>
        <Chip variant={'soft'} size={'lg'}>
          <Typography level={'body-md'}>
            Note: Headers with{' '}
            <Typography sx={{ fontWeight: 'bold' }} color={'primary'}>
              bold
            </Typography>{' '}
            styling are required!
          </Typography>
        </Chip>
        {uploadForm !== undefined && RenderFormExplanations(uploadForm)}
      </Stack>
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
          <FileList acceptedFiles={acceptedFiles} dataViewActive={dataViewActive} setDataViewActive={setDataViewActive} />
          {acceptedFiles.length > 0 && (
            <Button variant="contained" color="error" onClick={() => handleRemoveFile(dataViewActive - 1)} sx={{ mt: 2, alignSelf: 'center' }}>
              Delete Selected File
            </Button>
          )}
          <LoadingButton variant="contained" color="primary" disabled={acceptedFiles.length <= 0} onClick={handleInitialSubmit} sx={{ mt: 2 }}>
            Review Files
          </LoadingButton>
        </Grid>
      </Grid>
    </Box>
  );
}
