"use client";
import React, {useCallback, useState} from 'react';
import {useSession} from "next-auth/react";
import {DropzoneProps, DropzonePureProps, FileErrors, FileListProps, UploadValidationProps} from "@/config/macros";
import {ValidationTable} from "@/components/fileupload/validationtable";
import {usePlotContext} from "@/app/contexts/plotcontext";
import {FileRejection, FileWithPath, useDropzone} from 'react-dropzone';
import {parse, ParseConfig} from 'papaparse';
import {FileUploadIcon} from "@/components/icons";

import '@/styles/dropzone.css';
import {subtitle} from "@/config/primitives";
import {Card, CardContent, CardHeader, Pagination} from "@mui/material";
import {Skeleton} from "@mui/joy";
import Chip from "@mui/joy/Chip";
import Divider from "@mui/joy/Divider";
import LoadingButton from "@mui/lab/LoadingButton";
import {DropzoneLogic} from "@/components/fileupload/dropzone";
import {FileDisplay} from "@/components/fileupload/filelist";

/** COMPONENT STORAGE FOR FILE UPLOAD FUNCTIONS
 *
 * STORED COMPONENTS:
 * - FileList: generates file preview list
 * - DropzonePure: presentation side of dropzone box
 * - Dropzone: dropzone box upload logic/file type validation
 * - UploadAndValidateFiles: error display/upload completion display
 * - Filehandling: core logic for file upload/api fire
 */

/**
 * For uploading and validating drag and dropped CSV files.
 */
function UploadAndValidateFiles({
                                  uploadDone,
                                  isUploading,
                                  errorsData,
                                  acceptedFiles,
                                  handleUpload,
                                  handleAcceptedFiles,
                                }: UploadValidationProps) {
  if (uploadDone) {
    if (errorsData && Object.keys(errorsData).length == 0) {
      return (
        <div>
          {/*REVIEW UPLOAD CONTENT HERE*/}
          <p className={subtitle()}>
            Successfully uploaded.
          </p>
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
          <DropzoneLogic onChange={handleAcceptedFiles}/>
        </div>
        <div className={"flex flex-col m-auto"}>
          <div className={"flex justify-center"}>
            <FileDisplay acceptedFiles={acceptedFiles}/>
          </div>
          <Divider className={"my-4"}/>
          <div className={"flex justify-center"}>
            <LoadingButton disabled={acceptedFiles.length <= 0} loading={isUploading} onClick={handleUpload}>
              Upload to server
            </LoadingButton>
          </div>
        </div>
      </div>
    </>
  );
}

export function Filehandling() {
  const [acceptedFiles, setAcceptedFiles] = useState<FileWithPath[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [errorsData, setErrorsData] = useState<FileErrors>({});
  const [uploadDone, setUploadDone] = useState(false);
  let currentPlot = usePlotContext();
  const {data: session} = useSession();
  
  async function handleUpload() {
    setIsUploading(true);
    setUploadDone(false);
    if (acceptedFiles.length == 0 || acceptedFiles) {
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
    setIsUploading(false);
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
          setAcceptedFiles((files) => acceptedFiles.concat(files));
        }}
      />
    </>
  );
}