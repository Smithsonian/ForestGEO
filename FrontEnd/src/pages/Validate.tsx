/* eslint-disable prettier/prettier */
import Dropzone from '../components/Dropzone';
import FileList from '../components/FileList';
import Button, { displayDataTable } from '../components/Button';
import { FileWithPath } from 'react-dropzone';
import React, { useState } from 'react';
import ValidationTable from '../components/ValidationTable';

const Validate = () => {
  const initialState: Array<FileWithPath> = [];
  const [acceptedFilesList, setAcceptedFilesList] = useState(initialState);

  return (
    <>
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
        <Button
          label="UPLOAD"
          backgroundColor="#0F5530"
          textColor="white"
          onClick={displayDataTable}
        />
      </div>
      <div id="validationTable" style={{ display: 'none' }}>
        <ValidationTable error={false} errorMessage={{ 1: 'ERROR: message' }} />
      </div>
    </>
  );
};
export default Validate;
