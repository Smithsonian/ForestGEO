'use client';

import { ReviewStates, UploadStartProps } from '@/config/macros/uploadsystemmacros';
import { Box, Stack, Typography } from '@mui/joy';
import React, { useEffect, useState } from 'react';
import FinalizeSelectionsButton from '../../client/modals/finalizeselectionsbutton';
import SelectFormType from '../../uploadsystemhelpers/groupedformselection';
import { FormType, SourceFormat } from '@/config/macros/formdetails';

export default function UploadStart(props: Readonly<UploadStartProps>) {
  const { uploadForm, uploadMode, setUploadForm, setSourceFormat, setExpectedHeaders, setReviewState } = props;
  const [finish, setFinish] = useState<boolean>(false);

  // The picker emits a FormType string. ArcGIS resolves to the measurements
  // upload form while remaining distinguishable via the orthogonal sourceFormat
  // axis; every other choice is a plain CSV upload of that form.
  const handleFormSelection = (chosenValue: string) => {
    if (chosenValue === FormType.arcgis_xlsx) {
      setUploadForm(FormType.measurements);
      setSourceFormat(SourceFormat.arcgis_xlsx);
    } else {
      setUploadForm(chosenValue as FormType);
      setSourceFormat(SourceFormat.csv);
    }
  };

  // When finish is triggered, advance to upload files state
  useEffect(() => {
    if (finish) {
      setReviewState(ReviewStates.UPLOAD_FILES);
    }
  }, [finish, setReviewState]);

  const allSelectionsMade = uploadForm !== undefined;

  return (
    <Box
      sx={{
        display: 'flex',
        flex: 1,
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        '@keyframes fadeIn': {
          from: {
            opacity: 0,
            transform: 'translateY(20px)'
          },
          to: {
            opacity: 1,
            transform: 'translateY(0)'
          }
        },
        '@keyframes slideIn': {
          from: {
            opacity: 0,
            transform: 'translateX(-20px)'
          },
          to: {
            opacity: 1,
            transform: 'translateX(0)'
          }
        }
      }}
    >
      <Stack
        direction={'column'}
        spacing={3}
        sx={{
          width: 'fit-content',
          p: 4,
          borderRadius: 'lg',
          bgcolor: 'primary.softBg',
          boxShadow: theme => `0 8px 24px ${theme.palette.primary.softBg}`,
          animation: 'fadeIn 0.6s ease-out',
          minWidth: '400px'
        }}
      >
        {uploadForm === undefined && !finish && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, animation: 'slideIn 0.5s ease-out' }}>
            <Typography level="title-md" sx={{ fontWeight: 700, textAlign: 'center' }}>
              Choose a form to upload
            </Typography>
            <SelectFormType
              externalState={uploadForm ?? ''}
              updateExternalState={value => handleFormSelection(value as string)}
              updateExternalHeaders={setExpectedHeaders}
            />
          </Box>
        )}
        {uploadForm !== undefined && !finish && (
          <>
            <Typography
              level="h3"
              sx={{
                textAlign: 'center',
                fontWeight: 700,
                background: theme => `linear-gradient(135deg, ${theme.palette.text.primary} 0%, ${theme.palette.primary[600]} 100%)`,
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                animation: 'slideIn 0.5s ease-out'
              }}
            >
              Ready to Upload
            </Typography>
            <Box
              sx={{
                p: 2,
                borderRadius: 'md',
                bgcolor: 'success.softBg',
                borderLeft: theme => `4px solid ${theme.palette.success[400]}`,
                animation: 'slideIn 0.7s ease-out'
              }}
            >
              <Typography level="body-sm" sx={{ color: 'success.plainColor', fontWeight: 600, mb: 1 }}>
                You have selected:
              </Typography>
              <Typography level="title-md" sx={{ fontWeight: 700, color: 'success.solidBg' }}>
                Form: {uploadForm}
              </Typography>
              {uploadMode && (
                <Typography level="body-sm" sx={{ mt: 0.5, fontWeight: 600, color: 'success.solidBg' }}>
                  Mode: {uploadMode === 'clean_reupload' ? 'Clean Re-Upload' : 'Revisions Upload'}
                </Typography>
              )}
            </Box>
          </>
        )}
        <Box sx={{ animation: 'fadeIn 0.9s ease-out' }}>
          <FinalizeSelectionsButton onFinish={() => setFinish(true)} show={allSelectionsMade && !finish} />
        </Box>
      </Stack>
    </Box>
  );
}
