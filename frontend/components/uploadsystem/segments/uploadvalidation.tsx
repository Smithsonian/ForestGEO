'use client';
import React from 'react';
import { ReviewStates, UploadValidationProps } from '@/config/macros/uploadsystemmacros';
import ValidationCore, { ValidationResult } from '@/components/client/validationcore';
import ailogger from '@/ailogger';

const UploadValidation: React.FC<UploadValidationProps> = ({ setReviewState, isReingestion = false }) => {
  function handleValidationComplete(result: ValidationResult) {
    ailogger.info('Validation completed with result:', result);

    // If validation found failed measurements, transition to error state
    if (result.hasFailedMeasurements) {
      ailogger.warn(`Validation found ${result.failedCount} failed measurements. Transitioning to VALIDATE_ERRORS_FOUND state.`);
      setReviewState(ReviewStates.VALIDATE_ERRORS_FOUND);
    } else if (!result.success && result.errors.length > 0) {
      // Validation process had errors (not measurement failures)
      ailogger.error('Validation process encountered errors:', new Error(result.errors.join('; ')));
      setReviewState(ReviewStates.ERRORS);
    } else {
      // Validation completed successfully with no failures
      if (isReingestion) {
        // For reingestion, skip Azure upload and go directly to complete
        ailogger.info('Reingestion validation completed successfully. Proceeding to COMPLETE (skipping Azure upload).');
        setReviewState(ReviewStates.COMPLETE);
      } else {
        // For normal uploads, proceed to Azure upload
        ailogger.info('Validation completed successfully. Proceeding to Azure upload.');
        setReviewState(ReviewStates.UPLOAD_AZURE);
      }
    }
  }

  return <ValidationCore onValidationComplete={handleValidationComplete} />;
};

export default UploadValidation;
