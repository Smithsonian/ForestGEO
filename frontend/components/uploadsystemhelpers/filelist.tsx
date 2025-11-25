'use client';
import React from 'react';
import { FileListProps } from '@/config/macros/formdetails';

import '@/styles/dropzone.css';
import { Pagination } from '@mui/material';
import { Box, Card, CardContent, Chip, Divider, Stack, Typography } from '@mui/joy';

/**
 * A simple list of files with their sizes.
 */
export function FileList(props: Readonly<FileListProps>) {
  const { acceptedFiles, dataViewActive, setDataViewActive } = props;
  const handleChange = (event: React.ChangeEvent<unknown>, value: number) => {
    setDataViewActive(value); // Directly update the dataViewActive in the parent component
  };
  return (
    <Card sx={{ display: 'flex', flex: 1, flexDirection: 'column', width: '100%' }}>
      <CardContent>
        <Typography level="title-lg">File Preview:</Typography>
      </CardContent>
      <CardContent sx={{ display: 'flex', flex: 1, width: '100%' }}>
        <Box sx={{ display: 'flex', flex: 1, width: '100%' }}>
          <Stack direction={'column'}>
            <Box sx={{ display: 'inherit' }}>
              File Name: <br />
              <Chip color={'primary'}>
                {acceptedFiles?.length > 0 && acceptedFiles[dataViewActive - 1].path ? acceptedFiles[dataViewActive - 1].path! : ''}
              </Chip>
            </Box>
            <Divider className={'my-2'} />
            <Box sx={{ display: 'inherit' }}>
              File Size: <br />
              <Chip color={'primary'}>
                {acceptedFiles?.length > 0 && acceptedFiles[dataViewActive - 1].size ? acceptedFiles[dataViewActive - 1].size : ''} bytes
              </Chip>
            </Box>
          </Stack>
        </Box>
      </CardContent>
      <Box className={'flex justify-center'}>
        {acceptedFiles.length > 1 && <Pagination count={acceptedFiles.length} color={'secondary'} page={dataViewActive} onChange={handleChange} />}
      </Box>
    </Card>
  );
}
