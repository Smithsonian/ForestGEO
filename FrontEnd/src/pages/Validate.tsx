import Dropzone from '../components/Dropzone';
import FileList from '../components/FileList';
import Button from '../components/Button';
import { FileWithPath } from 'react-dropzone';
import SelectPlot, { Plot } from '../components/SelectPlot';

import React, { useState } from 'react';
import ValidationTable from '../components/ValidationTable';
import Container from '@mui/material/Container';
// import { CircularProgress } from '@mui/material';

const Validate = () => {
  const initialState: Array<FileWithPath> = [];
  const [acceptedFilesList, setAcceptedFilesList] = useState(initialState);
  const filesWithErrorsList: FileWithPath[] = [];
  // const [isLoading, setIsLoading] = useState(false);

  const errorsInitialState: {
    [fileName: string]: { [currentRow: string]: string };
  } = {};
  const [errorsData, setErrorsData] = useState(errorsInitialState);

  const [uploadClicked, setUploadClicked] = useState(false);
  const initialPlotState: Plot = { plotName: '', plotNumber: 0 };
  const [plot, setPlot] = React.useState(initialPlotState);

  const handleUpload = () => {
    const fileToFormData = new FormData();
    let i = 0;
    for (const file of acceptedFilesList) {
      fileToFormData.append(`file_${i}`, file);
      i++;
    }

    fetch('/api/upload?plot=' + plot.plotName, {
      method: 'Post',
      body: fileToFormData,
    })
      .then((response) => response.json())
      .then((data) => {
        setErrorsData(data.errors);
      })
      .then(() => setUploadClicked(true));
  };

  if (Object.keys(errorsData).length) {
    acceptedFilesList.forEach((file: FileWithPath) => {
      if (Object.keys(errorsData).includes(file.name.toString())) {
        filesWithErrorsList.push(file);
      }
    });
  }

  return (
    <>
      {uploadClicked && Object.keys(errorsData).length ? (
        <>
          <div id="validationTable">
            <ValidationTable
              error={true}
              errorMessage={errorsData}
              uploadedData={filesWithErrorsList}
            />
          </div>
        </>
      ) : (
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
              <Button label="UPLOAD TO SERVER" onClick={handleUpload} />
            )}
            {/* {isLoading && <CircularProgress />} */}
          </div>
        </>
      )}
    </>
  );
};
export default Validate;
