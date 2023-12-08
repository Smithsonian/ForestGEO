"use client";
import React, {useCallback} from 'react';
import {DropzoneProps, DropzonePureProps} from "@/config/macros";
import {FileRejection, FileWithPath, useDropzone} from 'react-dropzone';
import {parse, ParseConfig} from 'papaparse';
import {FileUploadIcon} from "@/components/icons";

import '@/styles/dropzone.css';
import {subtitle} from "@/config/primitives";


/**
 * This is the presentation component for Fileuploadcomponents.
 * It should be free of logic, and concentrate on the presentation.
 */
export function DropzoneCoreDisplay({getRootProps, getInputProps, isDragActive,}: DropzonePureProps) {
  return (
    <>
      <div id={"outerBox"} {...getRootProps()}
           className={"m-auto mt-8 border-sky-500 flex flex-col w-4/5 h-64 justify-center bg-[#46424f] align-middle"}>
        <div/>
        <p className={subtitle()} style={{textAlign: 'center'}}>
          {' '}
          <FileUploadIcon color="primary" size={80}/>{' '}
        </p>
        <input {...getInputProps()} />
        {isDragActive ? (
          <p className={subtitle()} color="primary" style={{textAlign: 'center'}}>
            Drop file here...
          </p>
        ) : (
          <p className={subtitle()} color="primary" style={{textAlign: 'center'}}>
            <b>Choose a CSV file</b> or drag it here.
          </p>
        )}
        <div/>
      </div>
    </>
  );
}


/**
 * A drop zone for CSV file uploads.
 */
export function DropzoneLogic({onChange}: DropzoneProps) {
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
    <DropzoneCoreDisplay
      isDragActive={isDragActive}
      getRootProps={getRootProps}
      getInputProps={getInputProps}
    />
  );
}
