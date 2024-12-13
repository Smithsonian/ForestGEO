'use client';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  Modal,
  ModalDialog,
  Stack,
  Tooltip,
  Typography
} from '@mui/joy';
import { UploadParseFilesProps } from '@/config/macros/uploadsystemmacros';
import { TableHeadersByFormType } from '@/config/macros/formdetails';
import { Button } from '@mui/material';
import Grid from '@mui/material/Grid2';
import { DropzoneLogic } from '@/components/uploadsystemhelpers/dropzone';
import { FileList } from '@/components/uploadsystemhelpers/filelist';
import { LoadingButton } from '@mui/lab';
import React, { useState } from 'react';
import { FileWithPath } from 'react-dropzone';
import WarningIcon from '@mui/icons-material/Warning';

export default function UploadParseFiles(props: Readonly<UploadParseFilesProps>) {
  const {
    uploadForm,
    personnelRecording,
    acceptedFiles,
    dataViewActive,
    setDataViewActive,
    parseFile,
    handleInitialSubmit,
    handleAddFile,
    handleReplaceFile,
    handleRemoveFile
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
            <LoadingButton variant="contained" color="primary" disabled={acceptedFiles.length <= 0} onClick={handleInitialSubmit} sx={{ mt: 2 }}>
              Review Files
            </LoadingButton>
          </Box>
        </Grid>
        <Grid size={6}>
          <Stack direction={'column'} sx={{ display: 'flex', flexDirection: 'column', mb: 10 }}>
            <Typography>You have selected {uploadForm}.</Typography>
            <Typography sx={{ mb: 2 }}>Please ensure that your file has the following headers (in any order) before continuing.</Typography>
            <Chip variant={'outlined'}>
              <Typography level={'body-md'}>
                Note: Headers with{' '}
                <Typography sx={{ fontWeight: 'bold' }} color={'primary'}>
                  bold
                </Typography>{' '}
                styling are required!
              </Typography>
            </Chip>
            {uploadForm !== undefined && (
              <Stack direction={'row'} flexWrap={'wrap'}>
                {TableHeadersByFormType[uploadForm].map((header, index) => (
                  <Card key={index} size={'sm'} sx={{ flex: '1 1 calc(50% - 1rem)' }}>
                    <Typography level={'title-sm'} color={'primary'} sx={{ fontWeight: header.category === 'required' ? 'bold' : 'normal' }}>
                      {header.label}
                    </Typography>
                    <CardContent>
                      <Typography level={'body-sm'}>{header.explanation}</Typography>
                      {header.label.includes('date') && (
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
                      )}
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            )}
          </Stack>
        </Grid>
      </Grid>
    </Box>
  );
}
