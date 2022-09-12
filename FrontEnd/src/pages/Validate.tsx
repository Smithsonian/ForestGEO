import Dropzone from '../components/Dropzone';
import FileList from '../components/FileList';
import { Button } from '@mui/material';
import { FileWithPath } from 'react-dropzone';
import SelectPlot, { Plot } from '../components/SelectPlot';

import React, { useState } from 'react';
import ValidationTable from '../components/ValidationTable';
import Container from '@mui/material/Container';
import { CircularProgress } from '@mui/material';

const Validate = () => {
  const initialState: Array<FileWithPath> = [];
  const [acceptedFilesList, setAcceptedFilesList] = useState(initialState);
  const filesWithErrorsList: FileWithPath[] = [];
  const [isUploading, setisUploading] = useState(false);

  const errorsInitialState: {
    [fileName: string]: { [currentRow: string]: string };
  } = {};
  const [errorsData, setErrorsData] = useState(errorsInitialState);

  const [uploadDone, setUploadDone] = useState(false);
  const initialPlotState: Plot = { plotName: '', plotNumber: 0 };
  const [plot, setPlot] = React.useState(initialPlotState);

  const handleUpload = async () => {
    const fileToFormData = new FormData();
    let i = 0;
    for (const file of acceptedFilesList) {
      fileToFormData.append(`file_${i}`, file);
      i++;
    }

    setisUploading(true);

    const response = await fetch('/api/upload?plot=' + plot.plotName, {
      method: 'Post',
      body: fileToFormData,
    });
    const data = await response.json();
    setErrorsData(data.errors);

    setisUploading(false);
    setUploadDone(true);
  };

  if (Object.keys(errorsData).length) {
    acceptedFilesList.forEach((file: FileWithPath) => {
      if (Object.keys(errorsData).includes(file.name.toString())) {
        filesWithErrorsList.push(file);
      }
    });
  }

  if (uploadDone) {
    if (Object.keys(errorsData).length === 0) {
      return (
        <>
          <h1>Succesfully uploaded!</h1>
        </>
      );
    } else {
      // Show errors with the data that were uploaded
      return (
        <>
          <div id="validationTable">
            <ValidationTable
              error={true}
              errorMessage={errorsData}
              uploadedData={filesWithErrorsList}
            />
          </div>
        </>
      );
    }
  }

  return (
    <>
      <Container fixed>
        <SelectPlot plot={plot} setPlot={setPlot} />
      </Container>
      <div id="dropZone">
        <Dropzone
          onChange={(acceptedFiles) => {
            setAcceptedFilesList((acceptedFilesList) => [
              ...acceptedFilesList,
              ...acceptedFiles,
            ]);
          }}
        />
        <FileList acceptedFilesList={acceptedFilesList} />
        {acceptedFilesList.length > 0 && plot.plotNumber > 0 && (
          <Button
            disabled={isUploading}
            variant="contained"
            onClick={handleUpload}
          >
            Upload to server
          </Button>
        )}
        {isUploading && <CircularProgress />}
      </div>
    </>
  );
};
export default Validate;
