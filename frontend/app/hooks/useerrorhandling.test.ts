/**
 * useErrorHandling Hook - Functional Tests
 *
 * Tests error management functionality for upload system
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useErrorHandling } from './useerrorhandling';

describe('useErrorHandling', () => {
  describe('Initial State', () => {
    it('should initialize with no error', () => {
      const { result } = renderHook(() => useErrorHandling());

      expect(result.current.error).toBeNull();
      expect(result.current.errorComponent).toBe('');
      expect(result.current.hasError).toBe(false);
    });

    it('should return empty error message initially', () => {
      const { result } = renderHook(() => useErrorHandling());

      expect(result.current.getErrorMessage()).toBe('');
    });
  });

  describe('Setting Errors', () => {
    it('should set a basic error', () => {
      const { result } = renderHook(() => useErrorHandling());
      const error = new Error('Upload failed');

      act(() => {
        result.current.setError(error);
      });

      expect(result.current.error).not.toBeNull();
      expect(result.current.error?.message).toBe('Upload failed');
      expect(result.current.hasError).toBe(true);
    });

    it('should set error with component context', () => {
      const { result } = renderHook(() => useErrorHandling());
      const error = new Error('Processing error');

      act(() => {
        result.current.setError(error, 'UploadFire');
      });

      expect(result.current.error?.message).toBe('Processing error');
      expect(result.current.errorComponent).toBe('UploadFire');
    });

    it('should set error with file context', () => {
      const { result } = renderHook(() => useErrorHandling());
      const error = new Error('File parse error');
      const file = { name: 'data.csv', path: '/uploads/data.csv' };

      act(() => {
        result.current.setError(error, 'UploadParseFiles', file);
      });

      expect(result.current.error?.message).toBe('File parse error');
      expect(result.current.error?.file).toEqual(file);
      expect(result.current.errorComponent).toBe('UploadParseFiles');
    });

    it('should handle non-Error objects', () => {
      const { result } = renderHook(() => useErrorHandling());

      act(() => {
        result.current.setError('String error message');
      });

      expect(result.current.error?.message).toBe('String error message');
      expect(result.current.hasError).toBe(true);
    });

    it('should capture error stack trace', () => {
      const { result } = renderHook(() => useErrorHandling());
      const error = new Error('Test error');

      act(() => {
        result.current.setError(error);
      });

      expect(result.current.error?.stack).toBeDefined();
      expect(result.current.error?.stack).toContain('Error: Test error');
    });

    it('should capture error code if present', () => {
      const { result } = renderHook(() => useErrorHandling());
      const error: any = new Error('Network error');
      error.code = 'ECONNREFUSED';

      act(() => {
        result.current.setError(error);
      });

      expect(result.current.error?.code).toBe('ECONNREFUSED');
    });

    it('should capture timestamp', () => {
      const { result } = renderHook(() => useErrorHandling());
      const error = new Error('Test error');
      const beforeTime = Date.now();

      act(() => {
        result.current.setError(error);
      });

      const afterTime = Date.now();

      expect(result.current.error?.timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(result.current.error?.timestamp).toBeLessThanOrEqual(afterTime);
    });
  });

  describe('Clearing Errors', () => {
    it('should clear error and component', () => {
      const { result } = renderHook(() => useErrorHandling());
      const error = new Error('Test error');

      act(() => {
        result.current.setError(error, 'TestComponent');
      });

      expect(result.current.hasError).toBe(true);

      act(() => {
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();
      expect(result.current.errorComponent).toBe('');
      expect(result.current.hasError).toBe(false);
    });

    it('should be idempotent when no error exists', () => {
      const { result } = renderHook(() => useErrorHandling());

      act(() => {
        result.current.clearError();
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe('Error Component Management', () => {
    it('should set error component independently', () => {
      const { result } = renderHook(() => useErrorHandling());

      act(() => {
        result.current.setErrorComponent('CustomComponent');
      });

      expect(result.current.errorComponent).toBe('CustomComponent');
    });

    it('should update error component', () => {
      const { result } = renderHook(() => useErrorHandling());

      act(() => {
        result.current.setErrorComponent('Component1');
      });

      expect(result.current.errorComponent).toBe('Component1');

      act(() => {
        result.current.setErrorComponent('Component2');
      });

      expect(result.current.errorComponent).toBe('Component2');
    });

    it('should check if error is from specific component', () => {
      const { result } = renderHook(() => useErrorHandling());

      act(() => {
        result.current.setError(new Error('Test'), 'UploadFire');
      });

      expect(result.current.isErrorFromComponent('UploadFire')).toBe(true);
      expect(result.current.isErrorFromComponent('UploadParseFiles')).toBe(false);
    });
  });

  describe('Error Message Formatting', () => {
    it('should return basic error message', () => {
      const { result } = renderHook(() => useErrorHandling());

      act(() => {
        result.current.setError(new Error('Upload failed'));
      });

      expect(result.current.getErrorMessage()).toBe('Upload failed');
    });

    it('should include component prefix when set', () => {
      const { result } = renderHook(() => useErrorHandling());

      act(() => {
        result.current.setError(new Error('Processing failed'), 'UploadFire');
      });

      expect(result.current.getErrorMessage()).toBe('[UploadFire] Processing failed');
    });

    it('should include file name when set', () => {
      const { result } = renderHook(() => useErrorHandling());

      act(() => {
        result.current.setError(new Error('Parse error'), undefined, { name: 'data.csv' });
      });

      expect(result.current.getErrorMessage()).toBe('Parse error (File: data.csv)');
    });

    it('should include both component and file when set', () => {
      const { result } = renderHook(() => useErrorHandling());

      act(() => {
        result.current.setError(new Error('Validation failed'), 'UploadValidation', { name: 'measurements.csv' });
      });

      expect(result.current.getErrorMessage()).toBe('[UploadValidation] Validation failed (File: measurements.csv)');
    });

    it('should return empty string when no error', () => {
      const { result } = renderHook(() => useErrorHandling());

      expect(result.current.getErrorMessage()).toBe('');
    });
  });

  describe('Error Replacement', () => {
    it('should replace existing error', () => {
      const { result } = renderHook(() => useErrorHandling());

      act(() => {
        result.current.setError(new Error('First error'), 'Component1');
      });

      expect(result.current.error?.message).toBe('First error');
      expect(result.current.errorComponent).toBe('Component1');

      act(() => {
        result.current.setError(new Error('Second error'), 'Component2');
      });

      expect(result.current.error?.message).toBe('Second error');
      expect(result.current.errorComponent).toBe('Component2');
    });

    it('should preserve component if not specified in replacement', () => {
      const { result } = renderHook(() => useErrorHandling());

      act(() => {
        result.current.setError(new Error('First error'), 'Component1');
      });

      act(() => {
        result.current.setError(new Error('Second error'));
      });

      expect(result.current.error?.message).toBe('Second error');
      expect(result.current.errorComponent).toBe('Component1');
    });
  });

  describe('Error Recovery Workflow', () => {
    it('should handle complete error recovery flow', () => {
      const { result } = renderHook(() => useErrorHandling());

      // No error initially
      expect(result.current.hasError).toBe(false);

      // Error occurs
      act(() => {
        result.current.setError(new Error('Upload failed'), 'UploadFire', { name: 'data.csv' });
      });

      expect(result.current.hasError).toBe(true);
      expect(result.current.getErrorMessage()).toBe('[UploadFire] Upload failed (File: data.csv)');
      expect(result.current.isErrorFromComponent('UploadFire')).toBe(true);

      // User acknowledges error and retries
      act(() => {
        result.current.clearError();
      });

      expect(result.current.hasError).toBe(false);
      expect(result.current.getErrorMessage()).toBe('');

      // New attempt succeeds (no error)
      expect(result.current.error).toBeNull();
    });

    it('should handle multiple error retry attempts', () => {
      const { result } = renderHook(() => useErrorHandling());

      // First attempt fails
      act(() => {
        result.current.setError(new Error('Attempt 1 failed'));
      });

      expect(result.current.hasError).toBe(true);

      act(() => {
        result.current.clearError();
      });

      // Second attempt fails
      act(() => {
        result.current.setError(new Error('Attempt 2 failed'));
      });

      expect(result.current.hasError).toBe(true);
      expect(result.current.error?.message).toBe('Attempt 2 failed');

      act(() => {
        result.current.clearError();
      });

      // Third attempt succeeds
      expect(result.current.hasError).toBe(false);
    });
  });

  describe('Hook Stability', () => {
    it('should maintain stable function references', () => {
      const { result, rerender } = renderHook(() => useErrorHandling());

      const initialFunctions = {
        setError: result.current.setError,
        clearError: result.current.clearError,
        setErrorComponent: result.current.setErrorComponent,
        getErrorMessage: result.current.getErrorMessage,
        isErrorFromComponent: result.current.isErrorFromComponent
      };

      rerender();

      expect(result.current.setError).toBe(initialFunctions.setError);
      expect(result.current.clearError).toBe(initialFunctions.clearError);
      expect(result.current.setErrorComponent).toBe(initialFunctions.setErrorComponent);
      expect(result.current.getErrorMessage).toBe(initialFunctions.getErrorMessage);
      expect(result.current.isErrorFromComponent).toBe(initialFunctions.isErrorFromComponent);
    });
  });

  describe('Edge Cases', () => {
    it('should handle null error object', () => {
      const { result } = renderHook(() => useErrorHandling());

      act(() => {
        result.current.setError(null);
      });

      expect(result.current.error?.message).toBe('null');
      expect(result.current.hasError).toBe(true);
    });

    it('should handle undefined error object', () => {
      const { result } = renderHook(() => useErrorHandling());

      act(() => {
        result.current.setError(undefined);
      });

      expect(result.current.error?.message).toBe('undefined');
      expect(result.current.hasError).toBe(true);
    });

    it('should handle object error without message', () => {
      const { result } = renderHook(() => useErrorHandling());
      const errorObj = { code: 'ERR_123', details: 'Something went wrong' };

      act(() => {
        result.current.setError(errorObj);
      });

      expect(result.current.error?.message).toBe(JSON.stringify(errorObj));
      expect(result.current.error?.code).toBe('ERR_123');
      expect(result.current.hasError).toBe(true);
    });

    it('should handle empty string error', () => {
      const { result } = renderHook(() => useErrorHandling());

      act(() => {
        result.current.setError('');
      });

      expect(result.current.error?.message).toBe('');
      expect(result.current.hasError).toBe(true);
    });

    it('should handle very long error messages', () => {
      const { result } = renderHook(() => useErrorHandling());
      const longMessage = 'Error: ' + 'A'.repeat(10000);

      act(() => {
        result.current.setError(new Error(longMessage));
      });

      expect(result.current.error?.message).toBe(longMessage);
      expect(result.current.error?.message.length).toBe(longMessage.length);
    });
  });
});
