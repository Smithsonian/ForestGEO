import Dropzone from './Dropzone';
import FileList from './FileList';
import { FileWithPath } from 'react-dropzone';
import React, { useState } from 'react';

const Validate = () => {
  const initialState: Array<FileWithPath> = [];
  const [acceptedFilesList, setAcceptedFilesList] = useState(initialState);

  return (
    <div>
      <Dropzone
        onChange={(acceptedFiles) => {
          setAcceptedFilesList((acceptedFilesList) => [
            ...acceptedFilesList,
            ...acceptedFiles,
          ]);
        }}
      />
      <FileList acceptedFilesList={acceptedFilesList} />
    </div>
  );
};
export default Validate;
