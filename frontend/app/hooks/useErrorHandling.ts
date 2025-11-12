/**
 * useErrorHandling Hook
 *
 * Manages error state for upload system:
 * - Error storage and clearing
 * - Error component tracking
 * - Error recovery actions
 *
 * Provides centralized error management to reduce component complexity
 */

import React, { useState, useCallback } from 'react';

export interface UploadError {
  message: string;
  file?: { name: string; path?: string };
  code?: string;
  stack?: string;
  timestamp?: number;
}

export interface UseErrorHandlingReturn {
  // State
  error: UploadError | null;
  errorComponent: string;
  hasError: boolean;

  // Actions
  setError: (error: Error | any, component?: string, file?: { name: string; path?: string }) => void;
  clearError: () => void;
  setErrorComponent: React.Dispatch<React.SetStateAction<string>>;

  // Utilities
  getErrorMessage: () => string;
  isErrorFromComponent: (component: string) => boolean;
}

/**
 * Custom hook for managing upload errors
 *
 * @example
 * const { error, setError, clearError, hasError } = useErrorHandling();
 *
 * // Set an error
 * try {
 *   await uploadFile();
 * } catch (e) {
 *   setError(e, 'UploadFire', { name: 'data.csv' });
 * }
 *
 * // Check for errors
 * if (hasError) {
 *   console.log(error.message);
 * }
 *
 * // Clear error
 * clearError();
 */
export function useErrorHandling(): UseErrorHandlingReturn {
  const [error, setErrorState] = useState<UploadError | null>(null);
  const [errorComponent, setErrorComponentState] = useState<string>('');

  /**
   * Set an error with context
   */
  const setError = useCallback((err: Error | any, component?: string, file?: { name: string; path?: string }) => {
    let message: string;
    let code: string | undefined;
    let stack: string | undefined;

    if (err instanceof Error) {
      message = err.message;
      code = (err as any).code;
      stack = err.stack;
    } else if (err === null || err === undefined) {
      message = String(err);
      code = undefined;
      stack = undefined;
    } else if (typeof err === 'object') {
      message = JSON.stringify(err);
      code = err.code;
      stack = err.stack;
    } else {
      message = String(err);
      code = undefined;
      stack = undefined;
    }

    const uploadError: UploadError = {
      message,
      code,
      stack,
      timestamp: Date.now(),
      file
    };

    setErrorState(uploadError);

    if (component) {
      setErrorComponentState(component);
    }
  }, []);

  /**
   * Clear all error state
   */
  const clearError = useCallback(() => {
    setErrorState(null);
    setErrorComponentState('');
  }, []);

  /**
   * Set which component the error originated from
   */
  const setErrorComponent = useCallback(
    (value: React.SetStateAction<string>) => {
      const component = typeof value === 'function' ? value(errorComponent) : value;
      setErrorComponentState(component);
    },
    [errorComponent]
  );

  /**
   * Get formatted error message
   */
  const getErrorMessage = useCallback((): string => {
    if (!error) return '';

    let message = error.message;

    if (error.file) {
      message = `${message} (File: ${error.file.name})`;
    }

    if (errorComponent) {
      message = `[${errorComponent}] ${message}`;
    }

    return message;
  }, [error, errorComponent]);

  /**
   * Check if error originated from specific component
   */
  const isErrorFromComponent = useCallback(
    (component: string): boolean => {
      return errorComponent === component;
    },
    [errorComponent]
  );

  return {
    // State
    error,
    errorComponent,
    hasError: error !== null,

    // Actions
    setError,
    clearError,
    setErrorComponent,

    // Utilities
    getErrorMessage,
    isErrorFromComponent
  };
}
