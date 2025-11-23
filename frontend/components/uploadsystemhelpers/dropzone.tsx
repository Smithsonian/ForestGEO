'use client';
import React, { useCallback } from 'react';
import { DropzoneProps, DropzonePureProps } from '@/config/macros';
import { FileRejection, FileWithPath, useDropzone } from 'react-dropzone';
import { parse, ParseConfig } from 'papaparse';
import { FileUploadIcon } from '@/components/icons';
import { useToast } from '@/components/toastnotification';

import '@/styles/dropzone.css';
import { subtitle } from '@/config/primitives';

/**
 * This is the presentation component for FileUploadComponents.
 * It should be free of logic, and concentrate on the presentation.
 */
export function DropzoneCoreDisplay({ getRootProps, getInputProps, isDragActive }: DropzonePureProps) {
  return (
    <>
      <style jsx>{`
        @keyframes float {
          0%,
          100% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-10px);
          }
        }
        @keyframes pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.7;
          }
        }
        @keyframes glow {
          0%,
          100% {
            box-shadow:
              0 0 20px rgba(14, 165, 233, 0.3),
              0 0 40px rgba(14, 165, 233, 0.1),
              inset 0 0 60px rgba(14, 165, 233, 0.05);
          }
          50% {
            box-shadow:
              0 0 30px rgba(14, 165, 233, 0.5),
              0 0 60px rgba(14, 165, 233, 0.2),
              inset 0 0 80px rgba(14, 165, 233, 0.1);
          }
        }
        .dropzone {
          margin: 2rem auto;
          margin-top: 2rem;
          border: 3px dashed;
          border-image: linear-gradient(135deg, rgba(14, 165, 233, 0.6) 0%, rgba(59, 130, 246, 0.4) 100%);
          border-image-slice: 1;
          display: flex;
          flex-direction: column;
          width: 80%;
          height: 16rem;
          justify-content: center;
          align-items: center;
          background: linear-gradient(135deg, rgba(14, 165, 233, 0.05) 0%, rgba(59, 130, 246, 0.02) 100%);
          border-radius: 1rem;
          transition: all 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55);
          position: relative;
          overflow: hidden;
        }
        .dropzone::before {
          content: '';
          position: absolute;
          top: 0;
          left: -100%;
          width: 100%;
          height: 100%;
          background: linear-gradient(90deg, transparent, rgba(14, 165, 233, 0.1), transparent);
          transition: left 0.5s ease;
        }
        .dropzone:hover {
          transform: scale(1.02);
          border-color: rgba(14, 165, 233, 0.8);
          box-shadow:
            0 8px 24px rgba(14, 165, 233, 0.2),
            inset 0 0 40px rgba(14, 165, 233, 0.05);
        }
        .dropzone:hover::before {
          left: 100%;
        }
        .dropzone-active {
          transform: scale(1.05);
          animation: glow 2s ease-in-out infinite;
          border-color: rgba(14, 165, 233, 1);
          background: linear-gradient(135deg, rgba(14, 165, 233, 0.15) 0%, rgba(59, 130, 246, 0.1) 100%);
        }
        .dropzone-icon {
          animation: float 3s ease-in-out infinite;
        }
        .dropzone-active .dropzone-icon {
          animation:
            float 1s ease-in-out infinite,
            pulse 1s ease-in-out infinite;
        }
      `}</style>
      <div
        id={'outerBox'}
        {...getRootProps()}
        className={`dropzone ${isDragActive ? 'dropzone-active' : ''}`}
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
        <div className={`${subtitle()} dropzone-icon`} style={{ textAlign: 'center' }} aria-hidden="true">
          <FileUploadIcon color="primary" size={80} />
        </div>
        <input {...getInputProps()} aria-describedby="file-upload-instructions" />
        <div id="file-upload-instructions" className={subtitle()} style={{ textAlign: 'center', marginTop: '1rem', fontSize: '1.1rem' }}>
          {isDragActive ? (
            <span style={{ fontWeight: 'bold', color: 'rgba(14, 165, 233, 1)' }}>Drop files here to upload...</span>
          ) : (
            <span>
              <strong>Click to select files</strong> or drag CSV, XLSX, or TXT files here
            </span>
          )}
        </div>
        <div className="sr-only">
          Supported file formats: CSV (.csv), Excel (.xlsx), and Text (.txt) files. Use Tab to navigate, Enter or Space to activate file selection.
        </div>
      </div>
    </>
  );
}

/**
 * A drop zone for CSV file uploads.
 */
export function DropzoneLogic({ onChange }: DropzoneProps) {
  const toast = useToast();

  const onDrop = useCallback(
    (acceptedFiles: FileWithPath[], rejectedFiles: FileRejection[]) => {
      acceptedFiles.forEach((file: FileWithPath) => {
        const reader = new FileReader();

        reader.onabort = () => {
          console.error('File reading was aborted');
          toast.warning(`File reading was aborted: ${file.name}`);
        };
        reader.onerror = () => {
          console.error('File reading has failed');
          toast.error(`Failed to read file: ${file.name}`);
        };
        reader.onload = () => {
          // Do whatever you want with the file contents
          const binaryStr = reader.result as string;
          const config: ParseConfig = { delimiter: ',' };
          const results = parse(binaryStr, config);

          if (results.errors.length) {
            console.error(`Error on row: ${results.errors[0].row}. ${results.errors[0].message}`);
            toast.warning(`Parse warning in ${file.name}: Row ${results.errors[0].row} - ${results.errors[0].message}`);
          }
        };
        reader.readAsText(file);
      });
      onChange(acceptedFiles, rejectedFiles);
      rejectedFiles.forEach((fileRejection: FileRejection) => {
        console.error(`File ${fileRejection.file.name} was rejected:`, fileRejection.errors);
        const errorMessages = fileRejection.errors.map(e => e.message).join(', ');
        toast.error(`File rejected: ${fileRejection.file.name} - ${errorMessages}`);
      });
    },
    [onChange, toast]
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
