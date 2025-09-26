'use client';
import React, { useCallback } from 'react';
import { DropzoneProps, DropzonePureProps } from '@/config/macros';
import { FileRejection, FileWithPath, useDropzone } from 'react-dropzone';
import { parse, ParseConfig } from 'papaparse';
import { FileUploadIcon } from '@/components/icons';

import '@/styles/dropzone.css';
import { subtitle } from '@/config/primitives';

/**
 * This is the presentation component for FileUploadComponents.
 * It should be free of logic, and concentrate on the presentation.
 */
export function DropzoneCoreDisplay({ getRootProps, getInputProps, isDragActive }: DropzonePureProps) {
  return (
    <>
      <div
        id={'outerBox'}
        {...getRootProps()}
        className={'m-auto mt-8 border-sky-500 flex flex-col w-4/5 h-64 justify-center bg-[#46424f] align-middle'}
        role="button"
        tabIndex={0}
        aria-label={isDragActive ? 'Drop files here to upload' : 'Click to select files or drag and drop CSV, XLSX, or TXT files here'}
        aria-describedby="file-upload-instructions"
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            // Trigger the file input
            const input = event.currentTarget.querySelector('input[type="file"]') as HTMLInputElement;
            input?.click();
          }
        }}
      >
        <div />
        <div className={subtitle()} style={{ textAlign: 'center' }} aria-hidden="true">
          <FileUploadIcon color="primary" size={80} />
        </div>
        <input {...getInputProps()} aria-describedby="file-upload-instructions" />
        <div id="file-upload-instructions" className={subtitle()} style={{ textAlign: 'center' }}>
          {isDragActive ? (
            <span>Drop files here to upload...</span>
          ) : (
            <span>
              <strong>Click to select files</strong> or drag CSV, XLSX, or TXT files here
            </span>
          )}
        </div>
        <div className="sr-only">
          Supported file formats: CSV (.csv), Excel (.xlsx), and Text (.txt) files. Use Tab to navigate, Enter or Space to activate file selection.
        </div>
        <div />
      </div>
    </>
  );
}

/**
 * A drop zone for CSV file uploads.
 */
export function DropzoneLogic({ onChange }: DropzoneProps) {
  const onDrop = useCallback(
    (acceptedFiles: FileWithPath[], rejectedFiles: FileRejection[]) => {
      acceptedFiles.forEach((file: FileWithPath) => {
        const reader = new FileReader();

        reader.onabort = () => {
          console.error('File reading was aborted');
          // In a real app, you would show a proper accessible error message
        };
        reader.onerror = () => {
          console.error('File reading has failed');
          // In a real app, you would show a proper accessible error message
        };
        reader.onload = () => {
          // Do whatever you want with the file contents
          const binaryStr = reader.result as string;
          const config: ParseConfig = { delimiter: ',' };
          const results = parse(binaryStr, config);

          if (results.errors.length) {
            console.error(`Error on row: ${results.errors[0].row}. ${results.errors[0].message}`);
            // In a real app, you would show a proper accessible error message
            // Only print the first error for now to avoid dialog clog
          }
        };
        reader.readAsText(file);
      });
      onChange(acceptedFiles, rejectedFiles);
      rejectedFiles.forEach((fileRejection: FileRejection) => {
        console.error(`File ${fileRejection.file.name} was rejected:`, fileRejection.errors);
        // In a real app, you would show a proper accessible error message
        // instead of using browser alerts
      });
    },
    [onChange]
  );
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/csv': ['.csv'],
      'text/xlsx': ['.xlsx'],
      'text/text': ['.txt']
    }
  });

  return <DropzoneCoreDisplay isDragActive={isDragActive} getRootProps={getRootProps} getInputProps={getInputProps} />;
}
