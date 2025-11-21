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
import { FormType } from '@/config/macros/formdetails';

export interface UploadStateType {
  uploadForm?: FormType;
  reviewState: ReviewStates;
  personnelRecording: string;
  isDataUnsaved: boolean;
  uploadCompleteMessage: string;
  dataViewActive: number;
}

// Action types for state reducer
type UploadStateAction =
  | { type: 'SET_UPLOAD_FORM'; payload: FormType | undefined }
  | { type: 'SET_REVIEW_STATE'; payload: ReviewStates }
  | { type: 'SET_PERSONNEL'; payload: string }
  | { type: 'SET_DATA_UNSAVED'; payload: boolean }
  | { type: 'SET_COMPLETE_MESSAGE'; payload: string }
  | { type: 'SET_DATA_VIEW_ACTIVE'; payload: number }
  | { type: 'RESET_TO_START' }
  | { type: 'INITIALIZE'; payload: { uploadForm?: FormType; reviewState?: ReviewStates } };

// Initial state
const initialState: UploadStateType = {
  uploadForm: undefined,
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
        reviewState: ReviewStates.START
      };

    case 'INITIALIZE':
      return {
        ...initialState,
        uploadForm: action.payload.uploadForm,
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
  setReviewState: Dispatch<React.SetStateAction<ReviewStates>>;
  setPersonnelRecording: Dispatch<React.SetStateAction<string>>;
  setIsDataUnsaved: Dispatch<React.SetStateAction<boolean>>;
  setUploadCompleteMessage: Dispatch<React.SetStateAction<string>>;
  setDataViewActive: Dispatch<React.SetStateAction<number>>;

  // Complex actions
  resetToStart: () => void;
  initialize: (uploadForm?: FormType, reviewState?: ReviewStates) => void;

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
export function useUploadState(overrideUploadForm?: FormType, skipToProcessing?: boolean): UseUploadStateReturn {
  // Use reducer for complex state management
  const [state, dispatch] = useReducer(uploadStateReducer, {
    ...initialState,
    uploadForm: overrideUploadForm,
    reviewState: skipToProcessing ? ReviewStates.UPLOAD_SQL : ReviewStates.START
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

  const initialize = useCallback((uploadForm?: FormType, reviewState?: ReviewStates) => {
    dispatch({ type: 'INITIALIZE', payload: { uploadForm, reviewState } });
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
