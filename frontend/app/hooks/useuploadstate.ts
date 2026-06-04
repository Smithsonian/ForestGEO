/**
 * useUploadState Hook
 *
 * Manages upload workflow state:
 * - Upload form type selection
 * - Review state progression
 * - Personnel recording
 * - Data unsaved warning
 * - Upload completion tracking
 *
 * Centralizes upload state management to reduce component complexity
 */

import React, { useCallback, useReducer, Dispatch } from 'react';
import { ReviewStates } from '@/config/macros/uploadsystemmacros';
import { FormType, SourceFormat } from '@/config/macros/formdetails';
import { UploadMode } from '@/config/uploadmodes';

export interface UploadStateType {
  uploadForm?: FormType;
  sourceFormat: SourceFormat;
  uploadMode?: UploadMode;
  reviewState: ReviewStates;
  personnelRecording: string;
  isDataUnsaved: boolean;
  uploadCompleteMessage: string;
  dataViewActive: number;
}

// Action types for state reducer
type UploadStateAction =
  | { type: 'SET_UPLOAD_FORM'; payload: FormType | undefined }
  | { type: 'SET_SOURCE_FORMAT'; payload: SourceFormat }
  | { type: 'SET_UPLOAD_MODE'; payload: UploadMode | undefined }
  | { type: 'SET_REVIEW_STATE'; payload: ReviewStates }
  | { type: 'SET_PERSONNEL'; payload: string }
  | { type: 'SET_DATA_UNSAVED'; payload: boolean }
  | { type: 'SET_COMPLETE_MESSAGE'; payload: string }
  | { type: 'SET_DATA_VIEW_ACTIVE'; payload: number }
  | { type: 'RESET_TO_START' }
  | { type: 'INITIALIZE'; payload: { uploadForm?: FormType; uploadMode?: UploadMode; reviewState?: ReviewStates } };

// Initial state
const initialState: UploadStateType = {
  uploadForm: undefined,
  sourceFormat: SourceFormat.csv,
  uploadMode: undefined,
  reviewState: ReviewStates.START,
  personnelRecording: '',
  isDataUnsaved: false,
  uploadCompleteMessage: '',
  dataViewActive: 1
};

// Reducer for complex state management
function uploadStateReducer(state: UploadStateType, action: UploadStateAction): UploadStateType {
  switch (action.type) {
    case 'SET_UPLOAD_FORM':
      return { ...state, uploadForm: action.payload };

    case 'SET_SOURCE_FORMAT':
      return { ...state, sourceFormat: action.payload };

    case 'SET_UPLOAD_MODE':
      return { ...state, uploadMode: action.payload };

    case 'SET_REVIEW_STATE':
      return { ...state, reviewState: action.payload };

    case 'SET_PERSONNEL':
      return { ...state, personnelRecording: action.payload };

    case 'SET_DATA_UNSAVED':
      return { ...state, isDataUnsaved: action.payload };

    case 'SET_COMPLETE_MESSAGE':
      return { ...state, uploadCompleteMessage: action.payload };

    case 'SET_DATA_VIEW_ACTIVE':
      return { ...state, dataViewActive: action.payload };

    case 'RESET_TO_START':
      return {
        ...initialState,
        uploadForm: undefined,
        sourceFormat: SourceFormat.csv,
        reviewState: ReviewStates.START
      };

    case 'INITIALIZE':
      return {
        ...initialState,
        uploadForm: action.payload.uploadForm,
        uploadMode: action.payload.uploadMode,
        reviewState: action.payload.reviewState || ReviewStates.START
      };

    default:
      return state;
  }
}

export interface UseUploadStateReturn {
  // State
  state: UploadStateType;
  dispatch: Dispatch<UploadStateAction>;

  // Convenience setters (compatible with React.Dispatch<SetStateAction<T>>)
  setUploadForm: Dispatch<React.SetStateAction<FormType | undefined>>;
  setSourceFormat: Dispatch<React.SetStateAction<SourceFormat>>;
  setUploadMode: Dispatch<React.SetStateAction<UploadMode | undefined>>;
  setReviewState: Dispatch<React.SetStateAction<ReviewStates>>;
  setPersonnelRecording: Dispatch<React.SetStateAction<string>>;
  setIsDataUnsaved: Dispatch<React.SetStateAction<boolean>>;
  setUploadCompleteMessage: Dispatch<React.SetStateAction<string>>;
  setDataViewActive: Dispatch<React.SetStateAction<number>>;

  // Complex actions
  resetToStart: () => void;
  initialize: (uploadForm?: FormType, reviewState?: ReviewStates, uploadMode?: UploadMode) => void;

  // Derived state
  isComplete: boolean;
  canProceed: boolean;
  needsPersonnel: boolean;
}

/**
 * Custom hook for managing upload workflow state
 *
 * @param overrideUploadForm - Optional initial upload form type
 * @param skipToProcessing - Whether to skip directly to processing
 *
 * @example
 * const {
 *   state,
 *   setUploadForm,
 *   setReviewState,
 *   isComplete,
 *   resetToStart
 * } = useUploadState();
 *
 * // Set upload form type
 * setUploadForm(FormType.measurements);
 *
 * // Progress to next state
 * setReviewState(ReviewStates.UPLOAD_FILES);
 *
 * // Check if complete
 * if (isComplete) {
 *   // Handle completion
 * }
 */
export function useUploadState(overrideUploadForm?: FormType, skipToProcessing?: boolean, overrideUploadMode?: UploadMode): UseUploadStateReturn {
  // Determine initial review state:
  // 1. If skipToProcessing is true, go directly to UPLOAD_SQL (reingestion mode)
  // 2. If form type is pre-determined (overrideUploadForm), skip START and go to UPLOAD_FILES
  // 3. Otherwise, start at START state
  const getInitialReviewState = (): ReviewStates => {
    if (skipToProcessing) return ReviewStates.UPLOAD_SQL;
    if (overrideUploadForm) return ReviewStates.UPLOAD_FILES;
    return ReviewStates.START;
  };

  // Use reducer for complex state management
  const [state, dispatch] = useReducer(uploadStateReducer, {
    ...initialState,
    uploadForm: overrideUploadForm,
    uploadMode: overrideUploadMode,
    reviewState: getInitialReviewState()
  });

  // Convenience setters - support both values and updater functions
  // Wrapped with useCallback to maintain stable references and prevent infinite loops
  // Note: We use useReducer, so we need to capture current state via closure for updater functions
  const stateRef = React.useRef(state);
  stateRef.current = state;

  const setUploadForm = useCallback((value: React.SetStateAction<FormType | undefined>) => {
    const form = typeof value === 'function' ? value(stateRef.current.uploadForm) : value;
    dispatch({ type: 'SET_UPLOAD_FORM', payload: form });
  }, []);

  const setSourceFormat = useCallback((value: React.SetStateAction<SourceFormat>) => {
    const sourceFormat = typeof value === 'function' ? value(stateRef.current.sourceFormat) : value;
    dispatch({ type: 'SET_SOURCE_FORMAT', payload: sourceFormat });
  }, []);

  const setUploadMode = useCallback((value: React.SetStateAction<UploadMode | undefined>) => {
    const uploadMode = typeof value === 'function' ? value(stateRef.current.uploadMode) : value;
    dispatch({ type: 'SET_UPLOAD_MODE', payload: uploadMode });
  }, []);

  const setReviewState = useCallback((value: React.SetStateAction<ReviewStates>) => {
    const reviewState = typeof value === 'function' ? value(stateRef.current.reviewState) : value;
    dispatch({ type: 'SET_REVIEW_STATE', payload: reviewState });
  }, []);

  const setPersonnelRecording = useCallback((value: React.SetStateAction<string>) => {
    const personnel = typeof value === 'function' ? value(stateRef.current.personnelRecording) : value;
    dispatch({ type: 'SET_PERSONNEL', payload: personnel });
  }, []);

  const setIsDataUnsaved = useCallback((value: React.SetStateAction<boolean>) => {
    const unsaved = typeof value === 'function' ? value(stateRef.current.isDataUnsaved) : value;
    dispatch({ type: 'SET_DATA_UNSAVED', payload: unsaved });
  }, []);

  const setUploadCompleteMessage = useCallback((value: React.SetStateAction<string>) => {
    const message = typeof value === 'function' ? value(stateRef.current.uploadCompleteMessage) : value;
    dispatch({ type: 'SET_COMPLETE_MESSAGE', payload: message });
  }, []);

  const setDataViewActive = useCallback((value: React.SetStateAction<number>) => {
    const page = typeof value === 'function' ? value(stateRef.current.dataViewActive) : value;
    dispatch({ type: 'SET_DATA_VIEW_ACTIVE', payload: page });
  }, []);

  // Complex actions
  const resetToStart = useCallback(() => {
    dispatch({ type: 'RESET_TO_START' });
  }, []);

  const initialize = useCallback((uploadForm?: FormType, reviewState?: ReviewStates, uploadMode?: UploadMode) => {
    dispatch({ type: 'INITIALIZE', payload: { uploadForm, uploadMode, reviewState } });
  }, []);

  // Derived state
  const isComplete = state.reviewState === ReviewStates.COMPLETE;

  const needsPersonnel = false; // Personnel is now optional for all upload types

  const canProceed = state.uploadForm !== undefined; // Personnel no longer required for measurements

  return {
    // State
    state,
    dispatch,

    // Convenience setters
    setUploadForm,
    setSourceFormat,
    setUploadMode,
    setReviewState,
    setPersonnelRecording,
    setIsDataUnsaved,
    setUploadCompleteMessage,
    setDataViewActive,

    // Complex actions
    resetToStart,
    initialize,

    // Derived state
    isComplete,
    canProceed,
    needsPersonnel
  };
}
