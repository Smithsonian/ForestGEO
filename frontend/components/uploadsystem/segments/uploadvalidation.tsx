'use client';
import React from 'react';
import { ReviewStates, UploadValidationProps } from '@/config/macros/uploadsystemmacros';
import ValidationCore from '@/components/client/validationcore';

const UploadValidation: React.FC<UploadValidationProps> = ({ setReviewState }) => {
  function handleValidationComplete() {
    setReviewState(ReviewStates.UPLOAD_AZURE);
  }

  return <ValidationCore onValidationComplete={handleValidationComplete} />;
};

export default UploadValidation;
