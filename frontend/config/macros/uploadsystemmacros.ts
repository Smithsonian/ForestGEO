import {DetailedCMIDRow} from "@/components/uploadsystem/uploadparent";
import React, {Dispatch, SetStateAction} from "react";
import {FileWithPath} from "react-dropzone";
import {CensusRDS} from "../sqlrdsdefinitions/censusrds";
import {Plot} from "../sqlrdsdefinitions/plotrds";
import {FileCollectionRowSet} from "./formdetails";

export interface UploadStartProps {
  // state vars
  uploadForm: string;
  personnelRecording: string;
  unitOfMeasurement: string;
  // state setters
  setUploadForm: Dispatch<SetStateAction<string>>;
  setPersonnelRecording: Dispatch<SetStateAction<string>>;
  setExpectedHeaders: Dispatch<SetStateAction<string[]>>;
  setReviewState: Dispatch<SetStateAction<ReviewStates>>;
  setUnitOfMeasurement: Dispatch<SetStateAction<string>>;
}

export interface UploadParseFilesProps {
  // state vars
  uploadForm: string;
  acceptedFiles: FileWithPath[];
  personnelRecording: string;
  dataViewActive: number;
  // state setters
  setDataViewActive: Dispatch<SetStateAction<number>>;
  // centralized functions
  parseFile: (file: FileWithPath) => Promise<void>;
  handleInitialSubmit: () => Promise<void>;
  handleAddFile: (newFile: FileWithPath) => void;
  handleRemoveFile: (fileIndex: number) => void;
  handleReplaceFile: (fileIndex: number, newFile: FileWithPath) => void;
}

export interface UploadReviewFilesProps {
  // state vars
  uploadForm: string;
  acceptedFiles: FileWithPath[];
  expectedHeaders: string[];
  parsedData: FileCollectionRowSet;
  errors: FileCollectionRowSet;
  errorRows: FileCollectionRowSet;
  confirmationDialogOpen: boolean;
  dataViewActive: number;
  currentFileHeaders: string[];
  // state setters
  setDataViewActive: Dispatch<SetStateAction<number>>;
  setAcceptedFiles: Dispatch<SetStateAction<FileWithPath[]>>;
  setReviewState: Dispatch<SetStateAction<ReviewStates>>;
  setParsedData: Dispatch<SetStateAction<FileCollectionRowSet>>;
  setErrors: Dispatch<SetStateAction<FileCollectionRowSet>>;
  setErrorRows: Dispatch<SetStateAction<FileCollectionRowSet>>;
  setUploadError: Dispatch<SetStateAction<any>>;
  setErrorComponent: Dispatch<SetStateAction<string>>;
  // centralized functions
  areHeadersValid: (actualHeaders: string[]) => boolean;
  handleChange: (_event: React.ChangeEvent<unknown>, value: number) => void;
  handleApproval: () => Promise<void>;
  handleCancel: () => Promise<void>;
  handleConfirm: () => Promise<void>;
  handleRemoveFile: (fileIndex: number) => void;
  handleReplaceFile: (fileIndex: number, newFile: FileWithPath) => Promise<void>;
}

export interface UploadFireProps {
  // contexts
  currentPlot: Plot;
  currentCensus: CensusRDS;
  schema: string;
  // state vars
  uploadForm: string;
  personnelRecording: string;
  unitOfMeasurement: string;
  acceptedFiles: FileWithPath[];
  parsedData: FileCollectionRowSet;
  uploadCompleteMessage: string;
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
  currentPlot: Plot;
  currentCensus: CensusRDS;
  user: string;
  // state vars
  uploadForm: string;
  acceptedFiles: FileWithPath[];
  cmErrors: CMError[];
  allRowToCMID: DetailedCMIDRow[];
  // state setters
  setIsDataUnsaved: React.Dispatch<React.SetStateAction<boolean>>;
  setUploadError: React.Dispatch<React.SetStateAction<any>>;
  setErrorComponent: React.Dispatch<React.SetStateAction<string>>;
  setReviewState: Dispatch<SetStateAction<ReviewStates>>;
}

export interface UploadValidationProps {
  // contexts
  currentPlot: Plot;
  currentCensus: CensusRDS;
  schema: string;
  // state setters
  setReviewState: React.Dispatch<React.SetStateAction<ReviewStates>>;
}

export interface UploadValidationErrorDisplayProps {
  // state vars
  uploadForm: string;
  allRowToCMID: DetailedCMIDRow[]; // Updated to use DetailedCMIDRow[]
  cmErrors: CMError[];
  // state setters
  setReviewState: Dispatch<SetStateAction<ReviewStates>>;
  setCMErrors: Dispatch<SetStateAction<CMError[]>>;
}

export interface UploadUpdateValidationsProps {
  // contexts
  currentPlot: Plot;
  currentCensus: CensusRDS;
  schema: string;
  // state setters
  setReviewState: Dispatch<SetStateAction<ReviewStates>>;
}

export interface UploadCompleteProps {
  // state vars
  uploadForm: string;
  // state setters
  setIsUploadModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
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
  acceptedFiles: FileWithPath[];
  // state setters
  setAcceptedFiles: Dispatch<SetStateAction<FileWithPath[]>>;
  setReviewState: Dispatch<SetStateAction<ReviewStates>>;
  // centralized functions
  handleReturnToStart: () => Promise<void>;
  resetError: () => Promise<void>;
}

export enum ReviewStates {
  START = "start",
  UPLOAD_FILES = "upload_files",
  REVIEW = "review",
  UPLOAD_SQL = "upload_sql",
  VALIDATE = "validate",
  VALIDATE_ERRORS_FOUND = "validate_errors_found",
  UPDATE = "update_rows",
  UPLOAD_AZURE = "upload_azure",
  COMPLETE = "complete",
  ERRORS = "errors",
  FILE_MISMATCH_ERROR = "file_mismatch_error"
}

export enum ReviewProgress {
  START = 1,
  UPLOAD_FILES = 2,
  REVIEW = 3,
  UPLOAD_SQL = 4,
  VALIDATE = 5,
  VALIDATE_ERRORS_FOUND = 6,
  UPDATE = 7,
  UPLOAD_AZURE = 8,
  COMPLETE = 9
}

// for validation error display ONLY

export interface CMError {
  CoreMeasurementID: number;
  ValidationErrorIDs: number[];
  Descriptions: string[];
}

