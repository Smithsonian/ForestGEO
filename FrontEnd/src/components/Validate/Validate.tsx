import { useState } from 'react';
import { Button, CircularProgress, Container, Typography } from '@mui/material';
import { FileWithPath } from 'react-dropzone';

import Dropzone from '../../components/Dropzone';
import FileList from '../../components/FileList';
import SelectPlot, { SelectPlotProps } from '../../components/SelectPlot';
import ValidationTable from '../../components/ValidationTable';

export interface ValidateProps extends SelectPlotProps {}

interface FileErrors {
  [fileName: string]: { [currentRow: string]: string };
}

export interface ValidatePureProps extends SelectPlotProps {
  /** true when the upload is done,
   * false when it's not done.
   * Also false when upload hasn't started.
   */
  uploadDone: boolean;
  /** true when the upload has started but not done. */
  isUploading: boolean;
  /** Keyed by filename, valued by a dict of errors for each row */
  errorsData: FileErrors;
  /** The files which have been set to be uploaded. */
  acceptedFiles: FileWithPath[];
  /** When an upload action is triggered. */
  handleUpload: () => Promise<void>;
  /** When the files are drag/dropped. */
  handleAcceptedFiles: (acceptedFiles: FileWithPath[]) => void;
}

/**
 * For uploading and validating drag and dropped CSV files.
 */
export function ValidatePure({
  uploadDone,
  isUploading,
  errorsData,
  acceptedFiles,
  handleUpload,
  handleAcceptedFiles,
  plot,
  setPlot,
}: ValidatePureProps) {
  if (uploadDone) {
    if (Object.keys(errorsData).length === 0) {
      return (
        <Container fixed>
          <Typography variant="h1" mt={2}>
            Successfully uploaded.
          </Typography>
        </Container>
      );
    } else {
      const filesWithErrorsList: FileWithPath[] = [];

      if (Object.keys(errorsData).length) {
        acceptedFiles.forEach((file: FileWithPath) => {
          if (Object.keys(errorsData).includes(file.name.toString())) {
            filesWithErrorsList.push(file);
          }
        });
      }

      // Show errors with the data that were uploaded
      return (
        <>
          <ValidationTable
            error={true}
            errorMessage={errorsData}
            uploadedData={filesWithErrorsList}
          />
        </>
      );
    }
  }

  return (
    <>
      <Container fixed>
        <SelectPlot plot={plot} setPlot={setPlot} />
      </Container>
      <Container fixed>
        {isUploading && <CircularProgress />}
        <Dropzone onChange={handleAcceptedFiles} />
        {acceptedFiles?.length && <FileList acceptedFiles={acceptedFiles} />}
        {acceptedFiles?.length > 0 && plot.plotNumber > 0 && (
          <Button
            disabled={isUploading}
            variant="contained"
            onClick={handleUpload}
          >
            Upload to server
          </Button>
        )}
      </Container>
    </>
  );
}

export default function Validate({ plot, setPlot }: ValidateProps) {
  const [acceptedFiles, setAcceptedFiles] = useState<FileWithPath[]>([]);
  const [isUploading, setisUploading] = useState(false);
  const [errorsData, setErrorsData] = useState<FileErrors>({});
  const [uploadDone, setUploadDone] = useState(false);

  return (
    <ValidatePure
      uploadDone={uploadDone}
      isUploading={isUploading}
      errorsData={errorsData}
      plot={plot}
      setPlot={setPlot}
      acceptedFiles={acceptedFiles}
      handleUpload={async () => {
        const fileToFormData = new FormData();
        let i = 0;
        for (const file of acceptedFiles) {
          fileToFormData.append(`file_${i}`, file);
          i++;
        }

        setisUploading(true);

        // @todo: wrap this in a try/catch, and set an error state.
        const response = await fetch('/api/upload?plot=' + plot.plotName, {
          method: 'Post',
          body: fileToFormData,
        });
        const data = await response.json();
        setErrorsData(data.errors);

        setisUploading(false);
        setUploadDone(true);
      }}
      handleAcceptedFiles={(acceptedFiles: FileWithPath[]) => {
        // @todo: what about rejectedFiles?
        setAcceptedFiles((files) => [...acceptedFiles, ...files]);
      }}
    />
  );
}
