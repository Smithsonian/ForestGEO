import { Box, Button, Typography } from '@mui/joy';
import React from 'react';
import { FileWithPath } from 'react-dropzone';
import { ReviewStates, UploadErrorProps } from '@/config/macros/uploadsystemmacros';

const UploadError = (props: Readonly<UploadErrorProps>) => {
  const { error, component, acceptedFiles, setAcceptedFiles, setReviewState, handleReturnToStart, resetError } = props;
  const handleParseError = async () => {
    await resetError();
    await handleReturnToStart();
    setReviewState(ReviewStates.UPLOAD_FILES);
  };

  const handleReviewError = async (errorFile: FileWithPath) => {
    if (errorFile) {
      const updatedFiles = acceptedFiles.filter(file => file !== errorFile);
      setAcceptedFiles(updatedFiles);
      await resetError();
      setReviewState(ReviewStates.REVIEW);
    } else {
      await resetError();
      await handleReturnToStart();
      setReviewState(ReviewStates.UPLOAD_FILES);
    }
  };

  const handleFireError = async (errorFile: FileWithPath) => {
    const updatedFiles = acceptedFiles.filter(file => file !== errorFile);
    setAcceptedFiles(updatedFiles);
    await resetError();
    setReviewState(ReviewStates.REVIEW);
  };

  const renderErrorAction = () => {
    switch (component) {
      case 'UploadParseFiles':
        return <Button onClick={handleParseError}>Return to Parse</Button>;
      case 'UploadReviewFiles':
        return <Button onClick={() => handleReviewError(error.file)}>Retry Review</Button>;
      case 'UploadFire':
        return (
          <Box>
            <Typography level={'body-lg'} fontWeight={'bold'} color={'danger'}>
              Please speak to an administrator. Error in file: {error}
            </Typography>
            <Button onClick={() => handleFireError(error.file)}>Return to Review</Button>
          </Box>
        );
      default:
        return <Button onClick={handleReturnToStart}>Return to Start</Button>;
    }
  };

  return (
    <Box>
      <Typography level={'title-lg'}>Error Occurred</Typography>
      <Typography level={'body-md'}>{error.message}</Typography>
      {renderErrorAction()}
      <Button onClick={resetError}>Retry</Button>
    </Box>
  );
};

export default UploadError;
