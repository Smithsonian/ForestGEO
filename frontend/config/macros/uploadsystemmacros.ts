import { DetailedCMIDRow } from '@/components/uploadsystem/uploadparent';
import React, { Dispatch, SetStateAction } from 'react';
import { FileWithPath } from 'react-dropzone';
import { FileCollectionRowSet, FormType } from '@/config/macros/formdetails';
import { UploadMode } from '@/config/uploadmodes';

// File upload constraints
export const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024; // 500MB per file
export const MAX_FILE_SIZE_MB = 500;
export const MAX_TOTAL_UPLOAD_SIZE_BYTES = 1024 * 1024 * 1024; // 1GB total per upload session

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export interface UploadStartProps {
  // state vars
  uploadForm: FormType | undefined;
  uploadMode: UploadMode | undefined;
  personnelRecording: string;
  // state setters
  setUploadForm: Dispatch<SetStateAction<FormType | undefined>>;
  setUploadMode: Dispatch<SetStateAction<UploadMode | undefined>>;
  setPersonnelRecording: Dispatch<SetStateAction<string>>;
  setExpectedHeaders: Dispatch<SetStateAction<string[]>>;
  setReviewState: Dispatch<SetStateAction<ReviewStates>>;
}

export interface UploadParseFilesProps {
  // state vars
  uploadForm: FormType | undefined;
  uploadMode: UploadMode | undefined;
  acceptedFiles: FileWithStream[];
  dataViewActive: number;
  selectedDelimiters: Record<string, string>;
  // state setters
  setDataViewActive: Dispatch<SetStateAction<number>>;
  setSelectedDelimiters: Dispatch<SetStateAction<Record<string, string>>>;
  // centralized functions
  handleInitialSubmit: () => Promise<void>;
  handleAddFile: (newFile: FileWithPath) => void;
  handleRemoveFile: (fileIndex: number) => void;
  handleReplaceFile: (fileIndex: number, newFile: FileWithPath) => void;
}

export interface UploadReviewFilesProps {
  // state vars
  uploadForm: FormType | undefined;
  acceptedFiles: FileWithStream[];
  expectedHeaders: string[];
  parsedData: FileCollectionRowSet;
  errors: FileCollectionRowSet;
  errorRows: FileCollectionRowSet;
  confirmationDialogOpen: boolean;
  dataViewActive: number;
  currentFileHeaders: string[];
  // state setters
  setDataViewActive: Dispatch<SetStateAction<number>>;
  setAcceptedFiles: Dispatch<SetStateAction<FileWithStream[]>>;
  setReviewState: Dispatch<SetStateAction<ReviewStates>>;
  setParsedData: Dispatch<SetStateAction<FileCollectionRowSet>>;
  setErrors: Dispatch<SetStateAction<FileCollectionRowSet>>;
  setErrorRows: Dispatch<SetStateAction<FileCollectionRowSet>>;
  setUploadError: Dispatch<SetStateAction<any>>;
  setErrorComponent: Dispatch<SetStateAction<string>>;
  // centralized functions
  areHeadersValid: (actualHeaders: string[]) => { isValid: boolean; missingHeaders: string[] };
  handleChange: (_event: React.ChangeEvent<unknown>, value: number) => void;
  handleApproval: () => Promise<void>;
  handleCancel: () => Promise<void>;
  handleConfirm: () => Promise<void>;
  handleRemoveFile: (fileIndex: number) => void;
  handleReplaceFile: (fileIndex: number, newFile: FileWithPath) => Promise<void>;
}

export interface UploadFireProps {
  // contexts
  schema: string;
  // state vars
  uploadForm: FormType | undefined;
  uploadMode: UploadMode | undefined;
  personnelRecording: string;
  acceptedFiles: FileWithStream[];
  parsedData: FileCollectionRowSet;
  uploadCompleteMessage: string;
  selectedDelimiters: Record<string, string>;
  // state setters
  setUploadCompleteMessage: Dispatch<SetStateAction<string>>;
  setIsDataUnsaved: React.Dispatch<React.SetStateAction<boolean>>;
  setUploadError: React.Dispatch<React.SetStateAction<any>>;
  setErrorComponent: React.Dispatch<React.SetStateAction<string>>;
  setReviewState: Dispatch<SetStateAction<ReviewStates>>;
  setAllRowToCMID: Dispatch<SetStateAction<DetailedCMIDRow[]>>;
}

export interface UploadFireAzureProps {
  // contexts
  user: string;
  // state vars
  uploadForm: FormType | undefined;
  acceptedFiles: FileWithStream[];
  allRowToCMID: DetailedCMIDRow[];
  // state setters
  setIsDataUnsaved: React.Dispatch<React.SetStateAction<boolean>>;
  setUploadError: React.Dispatch<React.SetStateAction<any>>;
  setErrorComponent: React.Dispatch<React.SetStateAction<string>>;
  setReviewState: Dispatch<SetStateAction<ReviewStates>>;
}

export interface UploadValidationProps {
  // contexts
  schema: string;
  // state setters
  setReviewState: React.Dispatch<React.SetStateAction<ReviewStates>>;
  // flags
  isReingestion?: boolean;
}

export interface UploadValidationErrorDisplayProps {
  // state vars
  uploadForm: FormType | undefined;
  allRowToCMID: DetailedCMIDRow[]; // Updated to use DetailedCMIDRow[]
  cmErrors: CMError[];
  // state setters
  setReviewState: Dispatch<SetStateAction<ReviewStates>>;
  setCMErrors: Dispatch<SetStateAction<CMError[]>>;
}

export interface UploadUpdateValidationsProps {
  // contexts
  schema: string;
  // state setters
  setReviewState: Dispatch<SetStateAction<ReviewStates>>;
}

export interface UploadCompleteProps {
  // state vars
  uploadForm: FormType | undefined;
  // state setters
  handleCloseUploadModal: () => void;
}

export interface ProgressStepperProps {
  progressTracker: ReviewProgress;
  setProgressTracker: Dispatch<SetStateAction<ReviewProgress>>;
  reviewState: ReviewStates;
}

export interface UploadErrorProps {
  // state vars
  error: any;
  component: string;
  acceptedFiles: FileWithStream[];
  // state setters
  setAcceptedFiles: Dispatch<SetStateAction<FileWithStream[]>>;
  setReviewState: Dispatch<SetStateAction<ReviewStates>>;
  // centralized functions
  handleReturnToStart: () => Promise<void>;
  resetError: () => Promise<void>;
}

export enum ReviewStates {
  START = 'start',
  UPLOAD_FILES = 'upload_files',
  REVIEW = 'review',
  UPLOAD_SQL = 'upload_sql',
  REVISION_MATCH = 'revision_match',
  REVISION_APPLY = 'revision_apply',
  VALIDATE = 'validate',
  VALIDATE_ERRORS_FOUND = 'validate_errors_found',
  UPDATE = 'update_rows',
  UPLOAD_AZURE = 'upload_azure',
  COMPLETE = 'complete',
  ERRORS = 'errors',
  FILE_MISMATCH_ERROR = 'file_mismatch_error'
}

export enum ReviewProgress {
  START = 1,
  UPLOAD_FILES = 2,
  REVIEW = 3,
  UPLOAD_SQL = 4,
  REVISION_MATCH = 5,
  REVISION_APPLY = 6,
  VALIDATE = 7,
  VALIDATE_ERRORS_FOUND = 8,
  UPDATE = 9,
  UPLOAD_AZURE = 10,
  COMPLETE = 11
}

// for validation error display ONLY

export interface CMError {
  coreMeasurementID: number;
  validationErrorIDs: number[];
  descriptions: string[];
  criteria: string[];
}

export interface ValidationPair {
  description: string;
  criterion: string;
}

export interface ErrorDetail {
  id: number;
  validationPairs: ValidationPair[];
}

export interface CoreMeasurementError {
  coreMeasurementID: number;
  errors: ErrorDetail[];
}

export type ErrorMap = Record<number, CoreMeasurementError>;

export class FileWithStream extends File implements FileWithPath {
  path?: string;
  useStreaming: boolean;

  constructor(file: File, stream: boolean, path?: string) {
    super([file], file.name, {
      type: file.type,
      lastModified: file.lastModified
    });
    this.useStreaming = stream;
    this.path = path;
  }
}
