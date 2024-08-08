'use client';

import React, { useEffect } from 'react';
import { ProgressStepperProps, ReviewProgress, ReviewStates } from '@/config/macros/uploadsystemmacros';
import { Step, stepClasses, StepIndicator, stepIndicatorClasses, Stepper, Typography } from '@mui/joy';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';

export default function ProgressStepper(props: Readonly<ProgressStepperProps>) {
  const { progressTracker, reviewState, setProgressTracker } = props;

  useEffect(() => {
    switch (reviewState) {
      case ReviewStates.START:
        setProgressTracker(ReviewProgress.START);
        break;
      case ReviewStates.UPLOAD_FILES:
        setProgressTracker(ReviewProgress.UPLOAD_FILES);
        break;
      case ReviewStates.REVIEW:
        setProgressTracker(ReviewProgress.REVIEW);
        break;
      case ReviewStates.UPLOAD_SQL:
        setProgressTracker(ReviewProgress.UPLOAD_SQL);
        break;
      case ReviewStates.VALIDATE:
        setProgressTracker(ReviewProgress.VALIDATE);
        break;
      case ReviewStates.VALIDATE_ERRORS_FOUND:
        setProgressTracker(ReviewProgress.VALIDATE_ERRORS_FOUND);
        break;
      case ReviewStates.UPDATE:
        setProgressTracker(ReviewProgress.UPDATE);
        break;
      case ReviewStates.UPLOAD_AZURE:
        setProgressTracker(ReviewProgress.UPLOAD_AZURE);
        break;
      case ReviewStates.COMPLETE:
        setProgressTracker(ReviewProgress.COMPLETE);
        break;
    }
  }, [reviewState, setProgressTracker]);

  return (
    <Stepper
      size="lg"
      sx={{
        width: '100%',
        '--StepIndicator-size': '3rem',
        '--Step-connectorInset': '0px',
        [`& .${stepIndicatorClasses.root}`]: {
          borderWidth: 4
        },
        [`& .${stepClasses.root}::after`]: {
          height: 4
        },
        [`& .${stepClasses.completed}`]: {
          [`& .${stepIndicatorClasses.root}`]: {
            borderColor: 'primary.300',
            color: 'primary.300'
          },
          '&::after': {
            bgcolor: 'primary.300'
          }
        },
        [`& .${stepClasses.active}`]: {
          [`& .${stepIndicatorClasses.root}`]: {
            borderColor: 'currentColor'
          }
        },
        [`& .${stepClasses.disabled} *`]: {
          color: 'neutral.outlinedDisabledColor'
        }
      }}
    >
      <Step
        active={progressTracker === ReviewProgress.START}
        completed={progressTracker > ReviewProgress.START}
        disabled={progressTracker < ReviewProgress.START}
        orientation="vertical"
        indicator={
          <StepIndicator variant={progressTracker === ReviewProgress.START ? 'solid' : 'outlined'} color="primary">
            {progressTracker === ReviewProgress.START ? <CheckRoundedIcon /> : <KeyboardArrowDownRoundedIcon />}
          </StepIndicator>
        }
      >
        <Typography
          level="h4"
          fontWeight="xl"
          endDecorator={
            <Typography fontSize="sm" fontWeight="normal">
              Table & Personnel Select
            </Typography>
          }
        >
          {ReviewProgress.START}
        </Typography>
      </Step>
      <Step
        active={progressTracker === ReviewProgress.UPLOAD_FILES}
        completed={progressTracker > ReviewProgress.UPLOAD_FILES}
        disabled={progressTracker < ReviewProgress.UPLOAD_FILES}
        orientation="vertical"
        indicator={
          <StepIndicator variant={progressTracker === ReviewProgress.UPLOAD_FILES ? 'solid' : 'outlined'} color="primary">
            {progressTracker === ReviewProgress.UPLOAD_FILES ? <CheckRoundedIcon /> : <KeyboardArrowDownRoundedIcon />}
          </StepIndicator>
        }
      >
        <Typography
          level="h4"
          fontWeight="xl"
          endDecorator={
            <Typography fontSize="sm" fontWeight="normal">
              Upload & Parse Files
            </Typography>
          }
        >
          {ReviewProgress.UPLOAD_FILES}
        </Typography>
      </Step>
      <Step
        active={progressTracker === ReviewProgress.REVIEW}
        completed={progressTracker > ReviewProgress.REVIEW}
        disabled={progressTracker < ReviewProgress.REVIEW}
        orientation="vertical"
        indicator={
          <StepIndicator variant={progressTracker === ReviewProgress.REVIEW ? 'solid' : 'outlined'} color="primary">
            {progressTracker === ReviewProgress.REVIEW ? <CheckRoundedIcon /> : <KeyboardArrowDownRoundedIcon />}
          </StepIndicator>
        }
      >
        <Typography
          level="h4"
          fontWeight="xl"
          endDecorator={
            <Typography fontSize="sm" fontWeight="normal">
              Review File Headers
            </Typography>
          }
        >
          {ReviewProgress.REVIEW}
        </Typography>
      </Step>
      <Step
        active={progressTracker === ReviewProgress.UPLOAD_SQL}
        completed={progressTracker > ReviewProgress.UPLOAD_SQL}
        disabled={progressTracker < ReviewProgress.UPLOAD_SQL}
        orientation="vertical"
        indicator={
          <StepIndicator variant={progressTracker === ReviewProgress.UPLOAD_SQL ? 'solid' : 'outlined'} color="neutral">
            {progressTracker === ReviewProgress.UPLOAD_SQL ? <CheckRoundedIcon /> : <KeyboardArrowDownRoundedIcon />}
          </StepIndicator>
        }
      >
        <Typography
          level="h4"
          fontWeight="xl"
          endDecorator={
            <Typography fontSize="sm" fontWeight="normal">
              Save files to SQL & Azure
            </Typography>
          }
        >
          {ReviewProgress.UPLOAD_SQL}
        </Typography>
      </Step>
      <Step
        active={progressTracker === ReviewProgress.VALIDATE}
        completed={progressTracker > ReviewProgress.VALIDATE}
        disabled={progressTracker < ReviewProgress.VALIDATE}
        orientation="vertical"
        indicator={
          <StepIndicator variant={progressTracker === ReviewProgress.VALIDATE ? 'solid' : 'outlined'} color="neutral">
            {progressTracker === ReviewProgress.VALIDATE ? <CheckRoundedIcon /> : <KeyboardArrowDownRoundedIcon />}
          </StepIndicator>
        }
      >
        <Typography
          level="h4"
          fontWeight="xl"
          endDecorator={
            <Typography fontSize="sm" fontWeight="normal">
              Validate New Measurements
            </Typography>
          }
        >
          {ReviewProgress.VALIDATE}
        </Typography>
      </Step>
      <Step
        active={progressTracker === ReviewProgress.VALIDATE_ERRORS_FOUND}
        completed={progressTracker > ReviewProgress.VALIDATE_ERRORS_FOUND}
        disabled={progressTracker < ReviewProgress.VALIDATE_ERRORS_FOUND}
        orientation="vertical"
        indicator={
          <StepIndicator variant={progressTracker === ReviewProgress.VALIDATE_ERRORS_FOUND ? 'solid' : 'outlined'} color="neutral">
            {progressTracker === ReviewProgress.VALIDATE_ERRORS_FOUND ? <CheckRoundedIcon /> : <KeyboardArrowDownRoundedIcon />}
          </StepIndicator>
        }
      >
        <Typography
          level="h4"
          fontWeight="xl"
          endDecorator={
            <Typography fontSize="sm" fontWeight="normal">
              Review Validation Errors
            </Typography>
          }
        >
          {ReviewProgress.VALIDATE_ERRORS_FOUND}
        </Typography>
      </Step>
      <Step
        active={progressTracker === ReviewProgress.UPDATE}
        completed={progressTracker > ReviewProgress.UPDATE}
        disabled={progressTracker < ReviewProgress.UPDATE}
        orientation="vertical"
        indicator={
          <StepIndicator variant={progressTracker === ReviewProgress.UPDATE ? 'solid' : 'outlined'} color="neutral">
            {progressTracker === ReviewProgress.UPDATE ? <CheckRoundedIcon /> : <KeyboardArrowDownRoundedIcon />}
          </StepIndicator>
        }
      >
        <Typography
          level="h4"
          fontWeight="xl"
          endDecorator={
            <Typography fontSize="sm" fontWeight="normal">
              Updating Validated Rows
            </Typography>
          }
        >
          {ReviewProgress.UPDATE}
        </Typography>
      </Step>
      <Step
        active={progressTracker === ReviewProgress.UPLOAD_AZURE}
        completed={progressTracker > ReviewProgress.UPLOAD_AZURE}
        disabled={progressTracker < ReviewProgress.UPLOAD_AZURE}
        orientation="vertical"
        indicator={
          <StepIndicator variant={progressTracker === ReviewProgress.UPLOAD_AZURE ? 'solid' : 'outlined'} color="neutral">
            {progressTracker === ReviewProgress.UPLOAD_AZURE ? <CheckRoundedIcon /> : <KeyboardArrowDownRoundedIcon />}
          </StepIndicator>
        }
      >
        <Typography
          level="h4"
          fontWeight="xl"
          endDecorator={
            <Typography fontSize="sm" fontWeight="normal">
              Uploading File to Azure
            </Typography>
          }
        >
          {ReviewProgress.UPLOAD_AZURE}
        </Typography>
      </Step>
      <Step
        active={progressTracker === ReviewProgress.COMPLETE}
        completed={progressTracker > ReviewProgress.COMPLETE}
        disabled={progressTracker < ReviewProgress.COMPLETE}
        orientation="vertical"
        indicator={
          <StepIndicator variant={progressTracker === ReviewProgress.COMPLETE ? 'solid' : 'outlined'} color="neutral">
            {progressTracker === ReviewProgress.COMPLETE ? <CheckRoundedIcon /> : <KeyboardArrowDownRoundedIcon />}
          </StepIndicator>
        }
      >
        <Typography
          level="h4"
          fontWeight="xl"
          endDecorator={
            <Typography fontSize="sm" fontWeight="normal">
              Completed
            </Typography>
          }
        >
          {ReviewProgress.COMPLETE}
        </Typography>
      </Step>
    </Stepper>
  );
}
