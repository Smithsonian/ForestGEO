'use client';
import React, { useCallback } from 'react';
import { FileRejection, FileWithPath, useDropzone } from 'react-dropzone';
import { Box, Chip, Stack, Typography } from '@mui/joy';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';

interface DropzoneCompactProps {
  onChange: (acceptedFiles: FileWithPath[], rejectedFiles: FileRejection[]) => void;
  hasFiles?: boolean;
}

export function DropzoneCompact({ onChange, hasFiles = false }: DropzoneCompactProps) {
  const onDrop = useCallback(
    (acceptedFiles: FileWithPath[], rejectedFiles: FileRejection[]) => {
      onChange(acceptedFiles, rejectedFiles);

      rejectedFiles.forEach((fileRejection: FileRejection) => {
        console.warn(`File ${fileRejection.file.name} rejected:`, fileRejection.errors);
      });
    },
    [onChange]
  );

  const { getRootProps, getInputProps, isDragActive, isDragAccept, isDragReject } = useDropzone({
    onDrop,
    accept: {
      'text/csv': ['.csv'],
      'text/plain': ['.txt', '.tsv'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx']
    },
    multiple: true
  });

  const getBorderColor = () => {
    if (isDragReject) return 'danger.300';
    if (isDragAccept) return 'success.300';
    if (isDragActive) return 'primary.300';
    return 'neutral.300';
  };

  const getBackgroundColor = () => {
    if (isDragReject) return 'danger.50';
    if (isDragAccept) return 'success.50';
    if (isDragActive) return 'primary.50';
    return hasFiles ? 'neutral.50' : 'background.surface';
  };

  const getTextColor = () => {
    if (isDragReject) return 'danger.600';
    if (isDragAccept) return 'success.600';
    if (isDragActive) return 'primary.600';
    return 'text.secondary';
  };

  return (
    <Box
      {...getRootProps()}
      sx={{
        border: '2px dashed',
        borderColor: getBorderColor(),
        borderRadius: 'md',
        bgcolor: getBackgroundColor(),
        p: 3,
        textAlign: 'center',
        cursor: 'pointer',
        transition: 'all 0.2s ease-in-out',
        minHeight: hasFiles ? 120 : 160,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        '&:hover': {
          bgcolor: 'primary.50',
          borderColor: 'primary.300'
        }
      }}
    >
      <input {...getInputProps()} />

      <Stack spacing={1.5} alignItems="center">
        <CloudUploadIcon
          sx={{
            fontSize: hasFiles ? 32 : 48,
            color: getTextColor(),
            opacity: isDragActive ? 1 : 0.7
          }}
        />

        {isDragActive ? (
          isDragAccept ? (
            <Typography level="body-md" color="success">
              Drop files here to add them
            </Typography>
          ) : (
            <Typography level="body-md" color="danger">
              Some files are not supported
            </Typography>
          )
        ) : (
          <Stack spacing={0.5} alignItems="center">
            <Typography level={hasFiles ? 'body-sm' : 'body-md'} sx={{ fontWeight: 'bold', color: getTextColor() }}>
              {hasFiles ? 'Add more files' : 'Choose files or drag them here'}
            </Typography>
            <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', justifyContent: 'center' }}>
              <Chip size="sm" variant="soft">
                CSV
              </Chip>
              <Chip size="sm" variant="soft">
                TXT
              </Chip>
              <Chip size="sm" variant="soft">
                TSV
              </Chip>
              <Chip size="sm" variant="soft">
                Excel
              </Chip>
            </Stack>
          </Stack>
        )}
      </Stack>
    </Box>
  );
}
