'use client';

import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Pagination } from '@mui/material';
import Grid from '@mui/material/Grid2';
import { Box, Checkbox, Modal, ModalClose, Typography } from '@mui/joy';
import { DisplayParsedDataGridInline } from '@/components/uploadsystemhelpers/displayparseddatagrid';
import Divider from '@mui/joy/Divider';
import React, { useEffect, useState } from 'react';
import { ReviewStates, UploadReviewFilesProps } from '@/config/macros/uploadsystemmacros';
import { FileWithPath } from 'react-dropzone';
import { FileList } from '@/components/uploadsystemhelpers/filelist';
import CircularProgress from '@mui/joy/CircularProgress';
import { DropzoneLogic } from '@/components/uploadsystemhelpers/dropzone';

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
    errors,
    setErrors,
    dataViewActive,
    setDataViewActive,
    currentFileHeaders,
    setUploadError,
    handleReplaceFile,
    areHeadersValid,
    handleApproval,
    confirmationDialogOpen,
    handleCancel,
    handleConfirm,
    handleRemoveFile
  } = props;

  const [isReuploadDialogOpen, setIsReuploadDialogOpen] = useState(false);
  const [reuploadInProgress, setReuploadInProgress] = useState(false);
  const [missingHeaders, setMissingHeaders] = useState<string[]>([]);
  const [requireReupload, setRequireReupload] = useState(false);
  const currentFileName = acceptedFiles[dataViewActive - 1]?.name;
  const requiredHeadersTrimmed = expectedHeaders.map(item => item.trim());

  useEffect(() => {
    if (currentFileHeaders.length === 0 || currentFileHeaders.some(header => header === '')) {
      setRequireReupload(true);
    } else {
      setRequireReupload(false);
    }
  }, [currentFileHeaders]);

  const handleReUploadFileChange = async (newFiles: FileWithPath[]) => {
    setReuploadInProgress(true);
    const newFile = newFiles[0];
    console.log('newFile: ', newFile);
    if (newFile.name !== currentFileName) {
      alert('Please upload a corrected version of the current file.');
      setIsReuploadDialogOpen(false);
      return;
    }

    await handleReplaceFile(dataViewActive - 1, newFile);

    setReuploadInProgress(false);
    setIsReuploadDialogOpen(false);
    setRequireReupload(false);
  };

  const handleApproveClick = async () => {
    const { isValid, missingHeaders } = areHeadersValid(currentFileHeaders);
    setMissingHeaders(missingHeaders);

    if (!isValid) {
      alert('The file headers are invalid or missing. Please re-upload a corrected file.');
      return;
    }
    const updatedParsedData = JSON.parse(JSON.stringify(parsedData));

    if (uploadForm === 'species') {
      Object.keys(updatedParsedData).forEach(fileName => {
        Object.keys(updatedParsedData[fileName]).forEach(rowKey => {
          const row = updatedParsedData[fileName][rowKey];
          const speciesField = row['species'];
          const genusField = row['genus'];
          if (speciesField && !genusField) {
            const speciesWords = speciesField.trim().split(/\s+/);
            if (speciesWords.length === 2) {
              const [genus, species] = speciesWords;
              updatedParsedData[fileName][rowKey]['genus'] = genus;
              updatedParsedData[fileName][rowKey]['species'] = species;
              if (!errors[fileName][rowKey]) {
                errors[fileName][rowKey] = {};
              }
              errors[fileName][rowKey]['genus'] = 'Genus was auto-filled based on species field.';
              errors[fileName][rowKey]['species'] = 'Species field was split into genus and species.';
            }
          }
        });
      });
    }

    setParsedData(updatedParsedData);

    console.log('Updated parsedData:', updatedParsedData); // Debug log

    try {
      await handleApproval();
    } catch (error) {
      console.error('Error during approval:', error);
      setUploadError(error);
      setReviewState(ReviewStates.ERRORS);
    }
  };

  const renderHeaderCheckboxes = () => {
    return requiredHeadersTrimmed.map(header => {
      const isChecked = currentFileHeaders.map(item => item.trim().toLowerCase()).includes(header.trim().toLowerCase());
      return (
        <Box key={header} sx={{ display: 'flex', flex: 1, alignItems: 'center' }}>
          <Checkbox size={'lg'} disabled checked={isChecked} label={header} color={isChecked ? 'success' : 'danger'} />
          <Divider orientation={'vertical'} sx={{ marginX: 2 }} />
        </Box>
      );
    });
  };

  const isFileUploadAllowed = () => {
    if (currentFileHeaders.length === 0) {
      return false;
    }
    const { isValid } = areHeadersValid(currentFileHeaders);
    return isValid || missingHeaders.length > 0;
  };

  return (
    <>
      <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
        {reuploadInProgress ? (
          <CircularProgress />
        ) : (
          <>
            <Button variant="contained" onClick={() => setReviewState(ReviewStates.UPLOAD_FILES)} sx={{ mb: 2, width: 'fit-content' }}>
              Back
            </Button>
            <Grid container spacing={2}>
              <Grid size={4} />
              <Grid size={4}>
                <Box
                  sx={{
                    display: 'flex',
                    flex: 1,
                    flexDirection: 'column',
                    alignItems: 'center'
                  }}
                >
                  <Button variant="contained" color="primary" onClick={async () => handleRemoveFile(dataViewActive - 1)} sx={{ width: 'fit-content' }}>
                    Remove Current File
                  </Button>
                  <Box sx={{ display: 'flex', flexDirection: 'row', mb: 2 }}>
                    <Divider orientation={'vertical'} sx={{ marginX: 2 }} />
                    {currentFileHeaders.length > 0 ? renderHeaderCheckboxes() : <Typography>No file selected or file has no headers.</Typography>}
                  </Box>
                  <FileList acceptedFiles={acceptedFiles} dataViewActive={dataViewActive} setDataViewActive={setDataViewActive} />
                </Box>
              </Grid>
              <Grid size={4} />
              <Grid size={12}>
                <Box sx={{ display: 'flex', flexDirection: 'column', mr: 10 }}>
                  {acceptedFiles.length > 0 && acceptedFiles[dataViewActive - 1] && currentFileHeaders.length > 0 && uploadForm !== undefined ? (
                    <>
                      <Typography level={'title-md'} color={'primary'} sx={{ marginBottom: 1 }}>
                        Form: {uploadForm}
                      </Typography>
                      <Typography level={'title-sm'}>File: {acceptedFiles[dataViewActive - 1].name}</Typography>
                      <DisplayParsedDataGridInline
                        parsedData={parsedData}
                        setParsedData={setParsedData}
                        errors={errors}
                        setErrors={setErrors}
                        errorRows={errorRows}
                        setErrorRows={setErrorRows}
                        formType={uploadForm}
                        fileName={acceptedFiles[dataViewActive - 1].name}
                      />
                    </>
                  ) : (
                    <Typography level="body-lg" bgcolor="error">
                      The selected file is missing required headers or the headers cannot be read. Please check the file and re-upload.
                      <br />
                      Your file&apos;s headers were: {currentFileHeaders.join(', ')}
                      <br />
                      The expected headers were {expectedHeaders.join(', ')}
                    </Typography>
                  )}
                </Box>
                <Pagination count={acceptedFiles.length} page={dataViewActive} onChange={(_, page) => setDataViewActive(page)} />
                <Button disabled onClick={() => setIsReuploadDialogOpen(true)} variant={'outlined'} color="primary" sx={{ marginTop: 2 }}>
                  Re-upload Corrected File
                </Button>
              </Grid>
              <Grid size={4} />
              <Grid size={4}>
                <Box
                  sx={{
                    display: 'flex',
                    flex: 1,
                    flexDirection: 'column',
                    alignItems: 'center'
                  }}
                >
                  <Button variant={'contained'} disabled={!isFileUploadAllowed() || requireReupload} onClick={handleApproveClick} sx={{ width: 'fit-content' }}>
                    Confirm Changes
                  </Button>
                </Box>
              </Grid>
              <Grid size={4} />
            </Grid>
          </>
        )}
      </Box>
      <Modal open={isReuploadDialogOpen || requireReupload} onClose={() => setIsReuploadDialogOpen(false)}>
        <Box>
          <ModalClose onClick={() => setIsReuploadDialogOpen(false)} />
          <DialogTitle>{requireReupload ? 'Headers Missing or Corrupted' : 'Re-upload Corrected File'}</DialogTitle>
          <DialogContent>
            <DialogContentText>
              {requireReupload
                ? 'The selected file is missing required headers or the headers cannot be read. Please upload a corrected version of the file.'
                : `Please upload the corrected version of the file: ${currentFileName}`}
            </DialogContentText>
            <DropzoneLogic onChange={handleReUploadFileChange} />
          </DialogContent>
          <DialogActions>{!requireReupload && <Button onClick={() => setIsReuploadDialogOpen(false)}>Close</Button>}</DialogActions>
        </Box>
      </Modal>
      <Dialog open={confirmationDialogOpen} onClose={handleCancel} aria-labelledby="alert-dialog-title" aria-describedby="alert-dialog-description">
        <DialogTitle id="alert-dialog-title">{'Do your files look correct?'}</DialogTitle>
        <DialogContent>
          <DialogContentText id="alert-dialog-description">
            {missingHeaders.length > 0 ? (
              <>
                The following required headers are missing: {missingHeaders.join(', ')}.<br />
                You can still proceed with the upload, but consider re-uploading the files with the required headers.
                <br />
                If you would like to re-upload a corrected file, you can do so by clicking &quot;Re-upload Corrected File&quot;.
              </>
            ) : (
              'Please press Confirm to upload your files to storage.'
            )}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancel}>Cancel</Button>
          <Button onClick={handleConfirm} autoFocus>
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
