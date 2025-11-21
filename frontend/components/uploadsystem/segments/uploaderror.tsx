import { Alert, Box, Button, Stack, Typography } from '@mui/joy';
import React from 'react';
import { FileWithPath } from 'react-dropzone';
import { ReviewStates, UploadErrorProps } from '@/config/macros/uploadsystemmacros';
import ErrorIcon from '@mui/icons-material/Error';

/**
 * Safely serialize an error object to a readable string
 * Handles nested objects and complex error structures
 */
const serializeError = (error: any): string => {
  if (!error) return 'An unknown error occurred';

  // If it's already a string, return it
  if (typeof error === 'string') return error;

  // Try to get error message
  let message = error.message || error.toString();

  // Check if message contains object serialization artifacts
  if (message.includes('[object Object]')) {
    try {
      // Attempt to extract meaningful information from the error
      if (error.message) {
        // Try to parse the message if it's a JSON string
        try {
          const parsed = JSON.parse(error.message);
          message = JSON.stringify(parsed, null, 2);
        } catch {
          // If not JSON, try to extract readable parts
          message = error.message.replace(/\[object Object\]/g, '');
        }
      }

      // If we still have [object Object], try to stringify the entire error
      if (message.includes('[object Object]') || !message) {
        message = JSON.stringify(error, Object.getOwnPropertyNames(error), 2);
      }
    } catch {
      // Fallback to basic error info
      message = `Error: ${error.name || 'Unknown'} - ${error.message || 'No details available'}`;
    }
  }

  // Clean up any remaining artifacts
  message = message.replace(/\[object Object\]/g, '[Error details unavailable]');

  return message || 'An error occurred with no details available';
};

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
        return <Button onClick={() => handleFireError(error.file)}>Return to Review</Button>;
      default:
        return <Button onClick={handleReturnToStart}>Return to Start</Button>;
    }
  };

  return (
    <Box
      sx={{
        p: 2,
        '@keyframes slideIn': {
          from: {
            opacity: 0,
            transform: 'translateY(-20px)'
          },
          to: {
            opacity: 1,
            transform: 'translateY(0)'
          }
        },
        '@keyframes shake': {
          '0%, 100%': { transform: 'translateX(0)' },
          '10%, 30%, 50%, 70%, 90%': { transform: 'translateX(-5px)' },
          '20%, 40%, 60%, 80%': { transform: 'translateX(5px)' }
        }
      }}
    >
      <Alert
        color="danger"
        variant="soft"
        startDecorator={
          <Box
            sx={{
              p: 1.5,
              borderRadius: 'md',
              bgcolor: 'danger.softBg',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <ErrorIcon sx={{ fontSize: 32, color: 'danger.solidBg' }} aria-hidden="true" />
          </Box>
        }
        sx={{
          mb: 3,
          p: 3,
          borderRadius: 'lg',
          boxShadow: theme => `0 8px 24px ${theme.palette.danger.softBg}`,
          background: theme => `linear-gradient(135deg, ${theme.palette.danger.softBg} 0%, rgba(239, 68, 68, 0.05) 100%)`,
          borderLeft: theme => `4px solid ${theme.palette.danger[500]}`,
          animation: 'slideIn 0.5s ease-out, shake 0.5s ease-out 0.5s'
        }}
      >
        <Stack spacing={2}>
          <Typography
            level="title-lg"
            sx={{
              fontWeight: 700,
              fontSize: '1.25rem',
              color: 'danger.solidBg'
            }}
          >
            Error Occurred
          </Typography>
          <Box
            sx={{
              p: 2,
              borderRadius: 'md',
              background: theme => `linear-gradient(135deg, ${theme.palette.neutral.softBg} 0%, rgba(0, 0, 0, 0.02) 100%)`,
              borderLeft: theme => `3px solid ${theme.palette.neutral[400]}`
            }}
          >
            <Typography
              level="body-md"
              sx={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontSize: '0.875rem',
                lineHeight: 1.6,
                fontFamily: 'monospace',
                color: 'text.primary'
              }}
            >
              {serializeError(error)}
            </Typography>
          </Box>
          {component === 'UploadFire' && (
            <Box
              sx={{
                p: 2,
                borderRadius: 'md',
                bgcolor: 'warning.softBg',
                borderLeft: theme => `3px solid ${theme.palette.warning[500]}`
              }}
            >
              <Typography level="body-md" fontWeight="bold" sx={{ color: 'warning.solidBg' }}>
                Please speak to an administrator about this error.
              </Typography>
            </Box>
          )}
        </Stack>
      </Alert>
      <Stack
        direction="row"
        spacing={2}
        sx={{
          flexWrap: 'wrap',
          animation: 'slideIn 0.7s ease-out'
        }}
      >
        {renderErrorAction()}
        <Button
          onClick={resetError}
          variant="outlined"
          color="neutral"
          sx={{
            transition: 'all 0.3s ease',
            '&:hover': {
              transform: 'translateY(-2px)',
              boxShadow: 'sm'
            }
          }}
        >
          Retry
        </Button>
      </Stack>
    </Box>
  );
};

export default UploadError;
