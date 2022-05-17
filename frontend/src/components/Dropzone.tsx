import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { parse, ParseConfig } from 'papaparse';
import Box from '@mui/material/Box';

export default function Dropzone() {
  // @ts-ignore
  const onDrop = useCallback((acceptedFiles) => {
    acceptedFiles.forEach((file: File) => {
      if (file.type !== 'text/csv') {
        // Not the right type of file, so we skip it for now.
        alert(
          'Only .csv files are supported. Uploaded file is called:' +
            file.name +
            ':'
        );
        // Skip this file
        return;
      }

      const reader = new FileReader();

      reader.onabort = () => alert('file reading was aborted');
      reader.onerror = () => alert('file reading has failed');
      reader.onload = () => {
        // Do whatever you want with the file contents
        const binaryStr = reader.result as string;
        console.log(binaryStr);
        console.log(parse(binaryStr));
        const config: ParseConfig = { delimiter: ',' };
        const results = parse(binaryStr, config);

        console.log(JSON.stringify(results.data));

        if (results.errors.length) {
          alert(
            `Error on row: ${results.errors[0].row}. ${results.errors[0].message}`
          );
          // Only print the first error for now to avoid dialog clog
        }
      };
      reader.readAsText(file);
    });
    // Do something with the files
    // console.log('acceptedFiles', acceptedFiles);
  }, []);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

  return (
    <Box
      sx={{
        width: 750,
        height: 450,
        typography: 'body1',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        justify: 'center',
        backgroundColor: 'primary.light',
        '&:hover': {
          backgroundColor: 'primary.main',
          opacity: [0.9, 0.8, 0.7],
        },
      }}
      {...getRootProps()}
    >
      <input {...getInputProps()} />
      {isDragActive ? (
        <p>Drop the files here ...</p>
      ) : (
        <p>Drag 'n' drop some files here, or click to select files</p>
      )}
    </Box>
  );
}
