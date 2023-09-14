"use client";
import React, {useCallback, useEffect} from 'react';
import {FileRejection, FileWithPath, useDropzone} from 'react-dropzone';
import {parse, ParseConfig} from 'papaparse';
import {FileUploadIcon} from "@/components/icons";
import {Box, Stack, Typography} from '@mui/joy';
import '@/styles/dropzone.css';
import {Pagination, Button, CardBody, Card} from "@nextui-org/react";

/**
 * These are the only FileWithPath attributes we use.
 * // import { FileWithPath } from 'react-dropzone';
 */
interface FileSize {
  path?: string;
  size: number;
  
  /** Can contain other fields, which we don't care about. */
  [otherFields: string]: any;
}

export interface FileListProps {
  acceptedFiles: FileSize[];
}

/**
 * A simple list of files with their sizes.
 */
export function FileList({acceptedFiles}: FileListProps) {
  const [currentPage, setCurrentPage] = React.useState(1);
  useEffect(() => {
  
  }, []);
  return acceptedFiles.length > 0 ? (
    <>
      <div className={"flex flex-col gap-5"}>
        <Card>
          <CardBody>
          
          </CardBody>
        </Card>
        <Pagination total={acceptedFiles.length} color={"secondary"} page={currentPage} onChange={setCurrentPage}/>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="flat"
            color="secondary"
            onPress={() => setCurrentPage((prev) => (prev > 1 ? prev - 1 : prev))}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="flat"
            color="secondary"
            onPress={() => setCurrentPage((prev) => (prev < 10 ? prev + 1 : prev))}
          >
            Next
          </Button>
        </div>
      </div>
      {/*<Listbox>*/}
      {/*  {acceptedFiles.map((file: FileSize) => (*/}
      {/*    <ListboxItem*/}
      {/*      key={file.path as string}*/}
      {/*      textValue={`${file.path} - ${file.size} bytes`}>*/}
      {/*    </ListboxItem>*/}
      {/*  ))}*/}
      {/*</Listbox>*/}
    </>
  ) : (
    <>
      <Typography variant={"solid"}>No files added</Typography>
    </>
  );
}

export interface DropzonePureProps {
  /** Is someone dragging file(s) onto the dropzone? */
  isDragActive: boolean;
  /** From react-dropzone, function which gets  for putting properties */
  getRootProps: any;
  /** From react-dropzone, function which gets properties for the input field. */
  getInputProps: any;
}

/**
 * This is the presentation component for Dropzone.
 * It should be free of logic, and concentrate on the presentation.
 */
export function DropzonePure({
                               getRootProps,
                               getInputProps,
                               isDragActive,
                             }: DropzonePureProps) {
  return (
    <Box
      id={'outerBox'}
      component={Stack}
      direction="column"
      sx={{
        m: 'auto',
        mt: 8,
        borderColor: 'primary.main',
      }}
      {...getRootProps()}
    >
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
    </Box>
  );
}

export interface DropzoneProps {
  /**
   * A callback function which is called when files given for upload.
   * Files can be given by the user either by dropping the files
   * with drag and drop, or by using the file viewfiles button.
   *
   * @param acceptedFiles - files which were accepted for upload.
   * @param rejectedFiles - files which are denied uploading.
   */
  onChange(acceptedFiles: FileWithPath[], rejectedFiles: FileRejection[]): void;
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