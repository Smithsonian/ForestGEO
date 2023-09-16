"use client";
import {useState} from 'react';
import {useSession} from "next-auth/react";
import {
  DropzoneProps,
  DropzonePureProps,
  FileErrors,
  FileListProps,
  UploadValidationProps
} from "@/config/macros";
import ValidationTable from "@/components/validationtable";
import {usePlotContext} from "@/app/plotcontext";
import React, {useCallback} from 'react';
import {FileRejection, FileWithPath, useDropzone} from 'react-dropzone';
import {parse, ParseConfig} from 'papaparse';
import {FileUploadIcon} from "@/components/icons";
import {Typography} from '@mui/joy';
import '@/styles/dropzone.css';
import {
  Pagination,
  Button,
  CardBody,
  Card,
  Divider,
  CardHeader,
  Skeleton,
  Spinner,
  CardFooter
} from "@nextui-org/react";

/** COMPONENT STORAGE FOR FILE UPLOAD FUNCTIONS
 *
 * STORED COMPONENTS:
 * - FileList: generates file preview list
 * - DropzonePure: presentation side of dropzone box
 * - Dropzone: dropzone box upload logic/file type validation
 * - UploadAndValidateFiles: error display/upload completion display
 * - FileUploader: core logic for file upload/api fire
 */

/**
 * A simple list of files with their sizes.
 */
export function FileList({acceptedFiles}: FileListProps) {
  const [currentPage, setCurrentPage] = React.useState(1);
  return (
    <>
      <Card className={"flex justify-center"} radius={"lg"}>
        <CardHeader>
          File Preview:
        </CardHeader>
        <CardBody>
          <Skeleton isLoaded={acceptedFiles?.length > 0} className={"rounded-lg"}>
            <div className={"h-24 rounded-lg"}>
              File Name: {(acceptedFiles?.length > 0 && acceptedFiles[currentPage - 1].path) ? acceptedFiles[currentPage - 1].path! : ''}
              File Size: {(acceptedFiles?.length > 0 && acceptedFiles[currentPage - 1].size) ? acceptedFiles[currentPage - 1].size! : ''} bytes
            </div>
          </Skeleton>
        </CardBody>
        <Divider className={"my-4"} />
        <CardFooter>
          <div className={"flex justify-center"} >
            <Pagination total={acceptedFiles.length} color={"secondary"} page={currentPage} onChange={setCurrentPage}/>
          </div>
        </CardFooter>
      </Card>
    </>
  );
}



/**
 * This is the presentation component for Fileuploadcomponents.
 * It should be free of logic, and concentrate on the presentation.
 */
export function DropzonePure({ getRootProps, getInputProps, isDragActive, }: DropzonePureProps) {
  return (
    <>
      <div id={"outerBox"} {...getRootProps()} className={"m-auto mt-8 border-sky-500 flex flex-col w-4/5 h-64 justify-center bg-[#46424f] align-middle"}>
        <div />
        <Typography sx={{textAlign: 'center'}}>
          {' '}
          <FileUploadIcon color="primary" size={80}/>{' '}
        </Typography>
        <input {...getInputProps()} />
        {isDragActive ? (
          <Typography color="primary" sx={{textAlign: 'center'}}>
            Drop file here...
          </Typography>
        ) : (
          <Typography color="primary" sx={{textAlign: 'center'}}>
            <b>Choose a CSV file</b> or drag it here.
          </Typography>
        )}
        <div />
      </div>
    </>
  );
}


/**
 * A drop zone for CSV file uploads.
 */
export function Dropzone({onChange}: DropzoneProps) {
  const onDrop = useCallback(
    (acceptedFiles: FileWithPath[], rejectedFiles: FileRejection[]) => {
      acceptedFiles.forEach((file: FileWithPath) => {
        const reader = new FileReader();
        
        reader.onabort = () => alert('file reading was aborted');
        reader.onerror = () => alert('file reading has failed');
        reader.onload = () => {
          // Do whatever you want with the file contents
          const binaryStr = reader.result as string;
          const config: ParseConfig = {delimiter: ','};
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
  const {getRootProps, getInputProps, isDragActive} = useDropzone({
    onDrop, accept: {
      'text/csv': ['.csv'],
    }
  });
  
  return (
    <DropzonePure
      isDragActive={isDragActive}
      getRootProps={getRootProps}
      getInputProps={getInputProps}
    />
  );
}

/**
 * For uploading and validating drag and dropped CSV files.
 */
function UploadAndValidateFiles({ uploadDone, isUploading, errorsData, acceptedFiles, handleUpload, handleAcceptedFiles,}: UploadValidationProps) {
  if (uploadDone) {
    if (errorsData && Object.keys(errorsData).length === 0) {
      return (
        <div>
          <Typography mt={2}>
            Successfully uploaded.
          </Typography>
        </div>
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
          <div className={"flex flex-col gap-5 w-3/5 h-3/5 justify-center"}>
            <ValidationTable
              errorMessage={errorsData}
              uploadedData={filesWithErrorsList}
              headers={[
                // @todo: these are hardcoded.
                {label: 'Tag'},
                {label: 'Subquadrat'},
                {label: 'SpCode'},
                {label: 'DBH'},
                {label: 'Htmeas'},
                {label: 'Codes'},
                {label: 'Comments'},
              ]}
            />
          </div>
        </>
      );
    }
  }
  
  return (
    <>
      <div className={"grid grid-cols-2"}>
        <div>
          <Dropzone onChange={handleAcceptedFiles}/>
        </div>
        <div className={"border-dashed border flex flex-col m-auto"}>
          <div className={"flex justify-center"}>
            <FileList acceptedFiles={acceptedFiles}/>
          </div>
          <Divider className={"my-4"} />
          <div className={"flex justify-center"}>
            <Button isDisabled={acceptedFiles.length <= 0} isLoading={isUploading} onClick={handleUpload} spinnerPlacement={"start"} spinner={<Spinner color={"primary"} size={"sm"} />}>
              Upload to server
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

export function FileUploader() {
  const [acceptedFiles, setAcceptedFiles] = useState<FileWithPath[]>([]);
  const [isUploading, setisUploading] = useState(false);
  const [errorsData, setErrorsData] = useState<FileErrors>({});
  const [uploadDone, setUploadDone] = useState(false);
  const {data: session} = useSession();
  let currentPlot = usePlotContext();
  async function handleUpload() {
    setisUploading(true);
    setUploadDone(false);
    if (acceptedFiles.length === 0 || acceptedFiles) {
      console.log("accepted files is empty for some reason??");
    }
    const fileToFormData = new FormData();
    let i = 0;
    for (const file of acceptedFiles) {
      fileToFormData.append(`file_${i}`, file);
      i++;
    }
    const response = await fetch('/api/upload?plot=' + currentPlot!.key + '&user=' + session!.user!.name!, {
      method: 'POST',
      body: fileToFormData,
    });
    const data = await response.json();
    setErrorsData(data.errors);
    setisUploading(false);
    setUploadDone(true);
  }
  if (!currentPlot || !currentPlot.key || !currentPlot.num) {
    return (
      <>
        <p>params doesn&apos;t exist OR plotkey doesn&apos;t exist OR plotnum doesn&apos;t exist</p>
      </>
    );
  }
  return (
    <>
      <UploadAndValidateFiles
        uploadDone={uploadDone}
        isUploading={isUploading}
        errorsData={errorsData}
        plot={currentPlot}
        acceptedFiles={acceptedFiles}
        handleUpload={handleUpload}
        handleAcceptedFiles={(acceptedFiles: FileWithPath[]) => {
          // @todo: what about rejectedFiles?
          setAcceptedFiles((files) => [...acceptedFiles, ...files]);
        }}
      />
    </>
  );
}