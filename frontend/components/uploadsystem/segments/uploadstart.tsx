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
        alignItems: 'center'
      }}
    >
      <Stack direction={'column'} sx={{ width: 'fit-content' }}>
        {uploadForm !== undefined && !finish && (
          <>
            <Typography sx={{ mb: 2 }}>You have selected:</Typography>
            <Typography>Form: {uploadForm}</Typography>
          </>
        )}
        <FinalizeSelectionsButton onFinish={() => setFinish(true)} show={allSelectionsMade && !finish} />
      </Stack>
    </Box>
  );
}
