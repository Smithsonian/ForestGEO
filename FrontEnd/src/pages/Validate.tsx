import Dropzone from '../components/Dropzone';
import FileList from '../components/FileList';
import Button from '../components/Button';
import { FileWithPath } from 'react-dropzone';
import SelectPlot, { Plot } from '../components/SelectPlot';

import React, { useState } from 'react';
import ValidationTable, { dataStructure } from '../components/ValidationTable';
import { parse } from 'papaparse';
import Container from '@mui/material/Container';

const Validate = () => {
  const initialState: Array<FileWithPath> = [];
  const [acceptedFilesList, setAcceptedFilesList] = useState(initialState);
  const [clicked, setClicked] = useState(false);
  const [finalData, setFinalData] = useState<dataStructure[]>([]);
  const data: dataStructure[] = [];

  const initialPlotState: Plot = { plotName: '', plotNumber: 0 };
  const [plot, setPlot] = React.useState(initialPlotState);

  const display = () => {
    acceptedFilesList.forEach((file: any) => {
      parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: function (results: any) {
          try {
            // eslint-disable-next-line array-callback-return
            results.data.map((i: dataStructure) => {
              data.push(i as dataStructure);
            });
            setFinalData(data);
            setClicked(true);
          } catch (e) {
            console.log(e);
          }
        },
      });
    });
  };

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
    });
  };

  return (
    <>
      {clicked ? (
        <div id="validationTable">
          <ValidationTable
            error={true}
            errorMessage={{ 1: 'ERROR: message' }}
            uploadedData={finalData}
          />
          <Button label="UPLOAD TO SERVER" onClick={handleUpload} />
        </div>
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
              <Button label="UPLOAD" onClick={display} />
            )}
          </div>
        </>
      )}
    </>
  );
};
export default Validate;
