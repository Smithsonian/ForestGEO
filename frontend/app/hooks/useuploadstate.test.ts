/**
 * useUploadState Hook - Functional Tests
 *
 * Tests upload workflow state management and transitions
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUploadState } from './useuploadstate';
import { ReviewStates } from '@/config/macros/uploadsystemmacros';
import { FormType, SourceFormat } from '@/config/macros/formdetails';

// Mock the AttributeStatusOptions export from core
vi.mock('@/config/sqlrdsdefinitions/core', () => ({
  AttributeStatusOptions: ['alive', 'dead', 'stem dead', 'broken below', 'omitted', 'missing']
}));

describe('useUploadState', () => {
  describe('Initial State', () => {
    it('should initialize with default state', () => {
      const { result } = renderHook(() => useUploadState());

      expect(result.current.state).toEqual({
        uploadForm: undefined,
        sourceFormat: SourceFormat.csv,
        reviewState: ReviewStates.START,
        personnelRecording: '',
        isDataUnsaved: false,
        uploadCompleteMessage: '',
        dataViewActive: 1
      });
    });

    it('should default sourceFormat to csv', () => {
      const { result } = renderHook(() => useUploadState());

      expect(result.current.state.sourceFormat).toBe(SourceFormat.csv);
    });

    it('should initialize with overridden upload form', () => {
      const { result } = renderHook(() => useUploadState(FormType.measurements));

      expect(result.current.state.uploadForm).toBe(FormType.measurements);
      // When form is pre-selected, hook skips START and goes directly to UPLOAD_FILES
      expect(result.current.state.reviewState).toBe(ReviewStates.UPLOAD_FILES);
    });

    it('should skip to processing when flag is set', () => {
      const { result } = renderHook(() => useUploadState(FormType.measurements, true));

      expect(result.current.state.uploadForm).toBe(FormType.measurements);
      expect(result.current.state.reviewState).toBe(ReviewStates.UPLOAD_SQL);
    });
  });

  describe('Upload Form Management', () => {
    it('should set upload form type', () => {
      const { result } = renderHook(() => useUploadState());

      act(() => {
        result.current.setUploadForm(FormType.measurements);
      });

      expect(result.current.state.uploadForm).toBe(FormType.measurements);
    });

    it('should clear upload form', () => {
      const { result } = renderHook(() => useUploadState(FormType.measurements));

      act(() => {
        result.current.setUploadForm(undefined);
      });

      expect(result.current.state.uploadForm).toBeUndefined();
    });

    it('should change upload form type', () => {
      const { result } = renderHook(() => useUploadState());

      act(() => {
        result.current.setUploadForm(FormType.measurements);
      });

      expect(result.current.state.uploadForm).toBe(FormType.measurements);

      act(() => {
        result.current.setUploadForm(FormType.species);
      });

      expect(result.current.state.uploadForm).toBe(FormType.species);
    });
  });

  describe('Source Format Management', () => {
    it('should set source format to arcgis_xlsx', () => {
      const { result } = renderHook(() => useUploadState());

      expect(result.current.state.sourceFormat).toBe(SourceFormat.csv);

      act(() => {
        result.current.setSourceFormat(SourceFormat.arcgis_xlsx);
      });

      expect(result.current.state.sourceFormat).toBe(SourceFormat.arcgis_xlsx);
    });

    it('should reset source format back to csv', () => {
      const { result } = renderHook(() => useUploadState());

      act(() => {
        result.current.setSourceFormat(SourceFormat.arcgis_xlsx);
      });

      expect(result.current.state.sourceFormat).toBe(SourceFormat.arcgis_xlsx);

      act(() => {
        result.current.setSourceFormat(SourceFormat.csv);
      });

      expect(result.current.state.sourceFormat).toBe(SourceFormat.csv);
    });

    it('should support functional updater form', () => {
      const { result } = renderHook(() => useUploadState());

      act(() => {
        result.current.setSourceFormat(prev => (prev === SourceFormat.csv ? SourceFormat.arcgis_xlsx : SourceFormat.csv));
      });

      expect(result.current.state.sourceFormat).toBe(SourceFormat.arcgis_xlsx);
    });
  });

  describe('Review State Progression', () => {
    it('should progress through review states', () => {
      const { result } = renderHook(() => useUploadState());

      expect(result.current.state.reviewState).toBe(ReviewStates.START);

      act(() => {
        result.current.setReviewState(ReviewStates.UPLOAD_FILES);
      });

      expect(result.current.state.reviewState).toBe(ReviewStates.UPLOAD_FILES);

      act(() => {
        result.current.setReviewState(ReviewStates.UPLOAD_SQL);
      });

      expect(result.current.state.reviewState).toBe(ReviewStates.UPLOAD_SQL);

      act(() => {
        result.current.setReviewState(ReviewStates.COMPLETE);
      });

      expect(result.current.state.reviewState).toBe(ReviewStates.COMPLETE);
      expect(result.current.isComplete).toBe(true);
    });

    it('should handle error state', () => {
      const { result } = renderHook(() => useUploadState());

      act(() => {
        result.current.setReviewState(ReviewStates.ERRORS);
      });

      expect(result.current.state.reviewState).toBe(ReviewStates.ERRORS);
      expect(result.current.isComplete).toBe(false);
    });

    it('should allow going back to previous states', () => {
      const { result } = renderHook(() => useUploadState());

      act(() => {
        result.current.setReviewState(ReviewStates.UPLOAD_SQL);
      });

      expect(result.current.state.reviewState).toBe(ReviewStates.UPLOAD_SQL);

      act(() => {
        result.current.setReviewState(ReviewStates.UPLOAD_FILES);
      });

      expect(result.current.state.reviewState).toBe(ReviewStates.UPLOAD_FILES);
    });
  });

  describe('Personnel Recording', () => {
    it('should set personnel recording', () => {
      const { result } = renderHook(() => useUploadState());

      act(() => {
        result.current.setPersonnelRecording('John Doe');
      });

      expect(result.current.state.personnelRecording).toBe('John Doe');
    });

    it('should clear personnel recording', () => {
      const { result } = renderHook(() => useUploadState());

      act(() => {
        result.current.setPersonnelRecording('John Doe');
      });

      expect(result.current.state.personnelRecording).toBe('John Doe');

      act(() => {
        result.current.setPersonnelRecording('');
      });

      expect(result.current.state.personnelRecording).toBe('');
    });

    it('should update personnel recording', () => {
      const { result } = renderHook(() => useUploadState());

      act(() => {
        result.current.setPersonnelRecording('John Doe');
      });

      act(() => {
        result.current.setPersonnelRecording('Jane Smith');
      });

      expect(result.current.state.personnelRecording).toBe('Jane Smith');
    });
  });

  describe('Data Unsaved Tracking', () => {
    it('should track data unsaved state', () => {
      const { result } = renderHook(() => useUploadState());

      expect(result.current.state.isDataUnsaved).toBe(false);

      act(() => {
        result.current.setIsDataUnsaved(true);
      });

      expect(result.current.state.isDataUnsaved).toBe(true);

      act(() => {
        result.current.setIsDataUnsaved(false);
      });

      expect(result.current.state.isDataUnsaved).toBe(false);
    });
  });

  describe('Upload Complete Message', () => {
    it('should set completion message', () => {
      const { result } = renderHook(() => useUploadState());

      act(() => {
        result.current.setUploadCompleteMessage('Upload successful!');
      });

      expect(result.current.state.uploadCompleteMessage).toBe('Upload successful!');
    });

    it('should clear completion message', () => {
      const { result } = renderHook(() => useUploadState());

      act(() => {
        result.current.setUploadCompleteMessage('Upload successful!');
        result.current.setUploadCompleteMessage('');
      });

      expect(result.current.state.uploadCompleteMessage).toBe('');
    });
  });

  describe('Data View Pagination', () => {
    it('should manage data view active page', () => {
      const { result } = renderHook(() => useUploadState());

      expect(result.current.state.dataViewActive).toBe(1);

      act(() => {
        result.current.setDataViewActive(2);
      });

      expect(result.current.state.dataViewActive).toBe(2);

      act(() => {
        result.current.setDataViewActive(5);
      });

      expect(result.current.state.dataViewActive).toBe(5);
    });
  });

  describe('Reset to Start', () => {
    it('should reset all state to initial values', () => {
      const { result } = renderHook(() => useUploadState());

      // Set various state values
      act(() => {
        result.current.setUploadForm(FormType.measurements);
        result.current.setSourceFormat(SourceFormat.arcgis_xlsx);
        result.current.setPersonnelRecording('John Doe');
        result.current.setReviewState(ReviewStates.UPLOAD_SQL);
        result.current.setIsDataUnsaved(true);
        result.current.setUploadCompleteMessage('Complete!');
        result.current.setDataViewActive(3);
      });

      // Verify state is set
      expect(result.current.state.uploadForm).toBe(FormType.measurements);
      expect(result.current.state.sourceFormat).toBe(SourceFormat.arcgis_xlsx);
      expect(result.current.state.personnelRecording).toBe('John Doe');
      expect(result.current.state.reviewState).toBe(ReviewStates.UPLOAD_SQL);

      // Reset
      act(() => {
        result.current.resetToStart();
      });

      // Verify all state is reset
      expect(result.current.state).toEqual({
        uploadForm: undefined,
        sourceFormat: SourceFormat.csv,
        reviewState: ReviewStates.START,
        personnelRecording: '',
        isDataUnsaved: false,
        uploadCompleteMessage: '',
        dataViewActive: 1
      });
    });
  });

  describe('Initialize', () => {
    it('should initialize with specific form and state', () => {
      const { result } = renderHook(() => useUploadState());

      act(() => {
        result.current.initialize(FormType.species, ReviewStates.UPLOAD_FILES);
      });

      expect(result.current.state.uploadForm).toBe(FormType.species);
      expect(result.current.state.reviewState).toBe(ReviewStates.UPLOAD_FILES);
    });

    it('should re-initialize from existing state', () => {
      const { result } = renderHook(() => useUploadState());

      // Set initial state
      act(() => {
        result.current.setUploadForm(FormType.measurements);
        result.current.setPersonnelRecording('John Doe');
        result.current.setReviewState(ReviewStates.COMPLETE);
      });

      // Re-initialize
      act(() => {
        result.current.initialize(FormType.species, ReviewStates.START);
      });

      expect(result.current.state.uploadForm).toBe(FormType.species);
      expect(result.current.state.reviewState).toBe(ReviewStates.START);
      expect(result.current.state.personnelRecording).toBe(''); // Should reset
    });
  });

  describe('Derived State - isComplete', () => {
    it('should be false initially', () => {
      const { result } = renderHook(() => useUploadState());

      expect(result.current.isComplete).toBe(false);
    });

    it('should be true when review state is COMPLETE', () => {
      const { result } = renderHook(() => useUploadState());

      act(() => {
        result.current.setReviewState(ReviewStates.COMPLETE);
      });

      expect(result.current.isComplete).toBe(true);
    });

    it('should be false for error state', () => {
      const { result } = renderHook(() => useUploadState());

      act(() => {
        result.current.setReviewState(ReviewStates.ERRORS);
      });

      expect(result.current.isComplete).toBe(false);
    });
  });

  describe('Derived State - needsPersonnel', () => {
    it('should be false for non-measurement forms', () => {
      const { result } = renderHook(() => useUploadState());

      act(() => {
        result.current.setUploadForm(FormType.species);
      });

      expect(result.current.needsPersonnel).toBe(false);
    });

    it('should be false for measurements without personnel (personnel now optional)', () => {
      const { result } = renderHook(() => useUploadState());

      act(() => {
        result.current.setUploadForm(FormType.measurements);
      });

      expect(result.current.needsPersonnel).toBe(false);
    });

    it('should be false for measurements with personnel', () => {
      const { result } = renderHook(() => useUploadState());

      act(() => {
        result.current.setUploadForm(FormType.measurements);
        result.current.setPersonnelRecording('John Doe');
      });

      expect(result.current.needsPersonnel).toBe(false);
    });
  });

  describe('Derived State - canProceed', () => {
    it('should be false without upload form', () => {
      const { result } = renderHook(() => useUploadState());

      expect(result.current.canProceed).toBe(false);
    });

    it('should be true for non-measurement forms', () => {
      const { result } = renderHook(() => useUploadState());

      act(() => {
        result.current.setUploadForm(FormType.species);
      });

      expect(result.current.canProceed).toBe(true);
    });

    it('should be true for measurements without personnel (personnel now optional)', () => {
      const { result } = renderHook(() => useUploadState());

      act(() => {
        result.current.setUploadForm(FormType.measurements);
      });

      expect(result.current.canProceed).toBe(true);
    });

    it('should be true for measurements with personnel', () => {
      const { result } = renderHook(() => useUploadState());

      act(() => {
        result.current.setUploadForm(FormType.measurements);
        result.current.setPersonnelRecording('John Doe');
      });

      expect(result.current.canProceed).toBe(true);
    });
  });

  describe('Hook Stability', () => {
    it('should maintain stable function references', () => {
      const { result, rerender } = renderHook(() => useUploadState());

      const initialSetters = {
        setUploadForm: result.current.setUploadForm,
        setReviewState: result.current.setReviewState,
        setPersonnelRecording: result.current.setPersonnelRecording,
        resetToStart: result.current.resetToStart
      };

      rerender();

      expect(result.current.setUploadForm).toBe(initialSetters.setUploadForm);
      expect(result.current.setReviewState).toBe(initialSetters.setReviewState);
      expect(result.current.setPersonnelRecording).toBe(initialSetters.setPersonnelRecording);
      expect(result.current.resetToStart).toBe(initialSetters.resetToStart);
    });
  });

  describe('Complex Workflows', () => {
    it('should handle complete upload workflow', () => {
      const { result } = renderHook(() => useUploadState());

      // Start workflow
      act(() => {
        result.current.setUploadForm(FormType.measurements);
      });

      expect(result.current.canProceed).toBe(true); // Personnel now optional, can proceed immediately

      // Set personnel (optional)
      act(() => {
        result.current.setPersonnelRecording('Field Worker');
      });

      expect(result.current.canProceed).toBe(true);

      // Progress through states
      act(() => {
        result.current.setReviewState(ReviewStates.UPLOAD_FILES);
        result.current.setIsDataUnsaved(true);
      });

      expect(result.current.state.isDataUnsaved).toBe(true);

      act(() => {
        result.current.setReviewState(ReviewStates.UPLOAD_SQL);
      });

      act(() => {
        result.current.setReviewState(ReviewStates.VALIDATE);
      });

      act(() => {
        result.current.setReviewState(ReviewStates.COMPLETE);
        result.current.setIsDataUnsaved(false);
        result.current.setUploadCompleteMessage('Upload successful!');
      });

      expect(result.current.isComplete).toBe(true);
      expect(result.current.state.isDataUnsaved).toBe(false);
      expect(result.current.state.uploadCompleteMessage).toBe('Upload successful!');
    });

    it('should handle error recovery workflow', () => {
      const { result } = renderHook(() => useUploadState());

      // Start workflow
      act(() => {
        result.current.setUploadForm(FormType.species);
        result.current.setReviewState(ReviewStates.UPLOAD_FILES);
      });

      // Encounter error
      act(() => {
        result.current.setReviewState(ReviewStates.ERRORS);
      });

      expect(result.current.isComplete).toBe(false);

      // Retry
      act(() => {
        result.current.setReviewState(ReviewStates.UPLOAD_FILES);
      });

      // Complete successfully
      act(() => {
        result.current.setReviewState(ReviewStates.COMPLETE);
      });

      expect(result.current.isComplete).toBe(true);
    });
  });
});
