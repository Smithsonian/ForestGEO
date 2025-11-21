'use client';

import { ReviewStates, UploadStartProps } from '@/config/macros/uploadsystemmacros';
import { Box, Stack, Typography } from '@mui/joy';
import React, { useEffect, useState } from 'react';
import FinalizeSelectionsButton from '../../client/modals/finalizeselectionsbutton';

export default function UploadStart(props: Readonly<UploadStartProps>) {
  const { uploadForm, setReviewState } = props;
  const [finish, setFinish] = useState<boolean>(false);

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
          background: theme => `linear-gradient(135deg, ${theme.palette.primary.softBg} 0%, ${theme.palette.primary[50]} 100%)`,
          boxShadow: theme => `0 8px 24px ${theme.palette.primary.softBg}`,
          animation: 'fadeIn 0.6s ease-out',
          minWidth: '400px'
        }}
      >
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
                background: theme => `linear-gradient(135deg, ${theme.palette.success.softBg} 0%, ${theme.palette.success[50]} 100%)`,
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
