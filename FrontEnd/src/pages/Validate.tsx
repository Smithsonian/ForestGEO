import Dropzone from '../components/Dropzone';
import FileList from '../components/FileList';
import { FileWithPath } from 'react-dropzone';
import React from 'react';

const Validate = () => {
  const [acceptedFiles, setAcceptedFiles] = React.useState<FileWithPath[]>([]);

  return (
    <div>
      <Dropzone onChange={setAcceptedFiles} />
      <FileList acceptedFiles={acceptedFiles} />
    </div>
  );
};
export default Validate;
