import React, { useCallback } from 'react';
import { useDropzone, FileWithPath, FileRejection } from 'react-dropzone';
import { parse, ParseConfig } from 'papaparse';
import Box from '@mui/material/Box';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import { Typography } from '@mui/material';
import { Stack } from '@mui/material';

export interface DropzonePureProps {
  isDragActive: boolean;
  getRootProps: any;
  getInputProps: any;
}

export function DropzonePure({
  getRootProps,
  getInputProps,
  isDragActive,
}: DropzonePureProps) {
  return (
    <Box
      component={Stack}
      direction="column"
      justifyContent="center"
      sx={{
        width: 700,
        height: 400,
        backgroundColor: '#E2EAE6',
        m: 'auto',
        mt: 8,
        border: '3px dashed',
        borderColor: 'primary.main',
      }}
      {...getRootProps()}
    >
      <Typography align="center">
        {' '}
        <FileUploadIcon color="primary" sx={{ fontSize: 80 }} />{' '}
      </Typography>
      <input {...getInputProps()} />
      {isDragActive ? (
        <Typography color="primary" align="center">
          Drop file here...
        </Typography>
      ) : (
        <Typography color="primary" align="center">
          <b>Choose a CSV file</b> or drag it here.
        </Typography>
      )}
    </Box>
  );
}

export interface DropzoneProps {
  onChange(acceptedFiles: FileWithPath[], rejectedFiles: FileRejection[]): void;
}

export default function Dropzone({ onChange }: DropzoneProps) {
  const onDrop = useCallback(
    (acceptedFiles: FileWithPath[], rejectedFiles: FileRejection[]) => {
      acceptedFiles.forEach((file: FileWithPath) => {
        const reader = new FileReader();

        reader.onabort = () => alert('file reading was aborted');
        reader.onerror = () => alert('file reading has failed');
        reader.onload = () => {
          // Do whatever you want with the file contents
          const binaryStr = reader.result as string;
          const config: ParseConfig = { delimiter: ',' };
          const results = parse(binaryStr, config);

          //console.log(JSON.stringify(results.data));

          if (results.errors.length) {
            alert(
              `Error on row: ${results.errors[0].row}. ${results.errors[0].message}`
            );
            // Only print the first error for now to avoid dialog clog
          }
        };
        reader.readAsText(file);
      });

      onChange(acceptedFiles, rejectedFiles);
      rejectedFiles.forEach((fileRejection: FileRejection) => {
        alert(
          ' The file ' +
            fileRejection.file.name +
            ' was not uploaded. Only .csv files are supported.'
        );
      });
    },
    [onChange]
  );
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: 'text/csv, application/vnd.ms-excel',
  });

  return (
    <DropzonePure
      isDragActive={isDragActive}
      getRootProps={getRootProps}
      getInputProps={getInputProps}
    />
  );
}
