import {Box} from '@mui/joy';
import React from 'react';
import {FileWithPath} from "react-dropzone";
import {ReviewStates} from "@/config/macros/uploadsystemmacros";
import {UploadErrorProps} from "@/config/macros/uploadsystemmacros";

const UploadError = (props: Readonly<UploadErrorProps>) => {
  const {error, component, acceptedFiles, setAcceptedFiles, setReviewState, handleReturnToStart, resetError} = props
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
        return <button onClick={handleParseError}>Return to Parse</button>;
      case 'UploadReviewFiles':
        return <button onClick={() => handleReviewError(error.file)}>Retry Review</button>;
      case 'UploadFire':
        return (
          <div>
            <p>Please speak to an administrator. Error in file: {error.file}, row: {error.row}</p>
            <button onClick={() => handleFireError(error.file)}>Return to Review</button>
          </div>
        );
      default:
        return <button onClick={handleReturnToStart}>Return to Start</button>;
    }
  };

  return (
    <Box>
      <h1>Error Occurred</h1>
      <p>{error.message}</p>
      {renderErrorAction()}
      <button onClick={resetError}>Retry</button>
      {/* This is the new button */}
    </Box>
  );
};

export default UploadError;