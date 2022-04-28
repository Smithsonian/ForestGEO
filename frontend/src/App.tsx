import React, { useCallback } from 'react';
import Button from '@mui/material/Button';
import { useDropzone } from 'react-dropzone';

function OurFriendlyDropzone() {
  // @ts-ignore
  const onDrop = useCallback((acceptedFiles) => {
    // Do something with the files
    console.log('acceptedFiles', acceptedFiles);
  }, []);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

  return (
    <div {...getRootProps()}>
      <input {...getInputProps()} />
      {isDragActive ? (
        <p>Drop the files here ...</p>
      ) : (
        <p>Drag 'n' drop some files here, or click to select files</p>
      )}
    </div>
  );
}

function App() {
  return (
    <>
      <OurFriendlyDropzone />
      <Button variant="contained">Hello World</Button>
    </>
  );
}

export default App;
