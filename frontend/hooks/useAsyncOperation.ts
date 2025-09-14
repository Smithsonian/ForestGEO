'use client';

import { useCallback, useRef } from 'react';
import { useLoading } from '@/app/contexts/loadingprovider';

interface UseAsyncOperationOptions {
  loadingMessage?: string;
  category?: 'api' | 'upload' | 'processing' | 'general';
  onSuccess?: (result: any) => void;
  onError?: (error: Error) => void;
  preventDuplicates?: boolean;
}

/**
 * Hook for managing async operations with automatic loading states
 * Provides operation deduplication, error handling, and loading state management
 */
export function useAsyncOperation<T extends any[], R>(asyncFunction: (...args: T) => Promise<R>, options: UseAsyncOperationOptions = {}) {
  const { loadingMessage = 'Processing...', category = 'general', onSuccess, onError, preventDuplicates = true } = options;

  const { startOperation, endOperation, isOperationActive } = useLoading();
  const activeOperationRef = useRef<string | null>(null);
  const lastArgsRef = useRef<string | null>(null);

  const execute = useCallback(
    async (...args: T): Promise<R | undefined> => {
      try {
        // Prevent duplicate operations if requested
        if (preventDuplicates) {
          const argsKey = JSON.stringify(args);

          // Check if same operation is already running
          if (activeOperationRef.current && isOperationActive(activeOperationRef.current)) {
            console.warn('Duplicate operation prevented:', loadingMessage);
            return;
          }

          // Check if same arguments were used recently (only for non-data loading operations)
          if (lastArgsRef.current === argsKey && !loadingMessage.toLowerCase().includes('loading')) {
            console.warn('Duplicate operation with same arguments prevented:', loadingMessage);
            return;
          }

          lastArgsRef.current = argsKey;
        }

        // Start loading operation
        const operationId = startOperation(loadingMessage, category);
        activeOperationRef.current = operationId;

        try {
          // Execute the async function
          const result = await asyncFunction(...args);

          // Handle success
          if (onSuccess) {
            onSuccess(result);
          }

          return result;
        } catch (error) {
          // Handle error
          const errorObj = error instanceof Error ? error : new Error(String(error));
          console.error(`Operation failed: ${loadingMessage}`, errorObj);

          if (onError) {
            onError(errorObj);
          } else {
            // Default error handling
            alert(`Operation failed: ${errorObj.message}`);
          }

          throw errorObj;
        } finally {
          // Always end the operation
          endOperation(operationId);
          activeOperationRef.current = null;

          // Clear args cache after a delay to allow for legitimate re-runs
          if (preventDuplicates) {
            setTimeout(() => {
              lastArgsRef.current = null;
            }, 2000);
          }
        }
      } catch (error) {
        // This catch handles any errors in the operation management itself
        console.error('Critical error in useAsyncOperation:', error);
        throw error;
      }
    },
    [asyncFunction, loadingMessage, category, onSuccess, onError, preventDuplicates, startOperation, endOperation, isOperationActive]
  );

  const isActive = activeOperationRef.current ? isOperationActive(activeOperationRef.current) : false;

  return {
    execute,
    isActive,
    operationId: activeOperationRef.current
  };
}

/**
 * Hook for wrapping existing async functions with loading states
 * Useful for quickly retrofitting existing code
 */
export function useAsyncWrapper() {
  const { startOperation, endOperation } = useLoading();

  const wrapAsync = useCallback(
    <T extends any[], R>(
      asyncFn: (...args: T) => Promise<R>,
      loadingMessage: string = 'Loading...',
      category: 'api' | 'upload' | 'processing' | 'general' = 'general'
    ) => {
      return async (...args: T): Promise<R> => {
        const operationId = startOperation(loadingMessage, category);

        try {
          const result = await asyncFn(...args);
          return result;
        } finally {
          endOperation(operationId);
        }
      };
    },
    [startOperation, endOperation]
  );

  return { wrapAsync };
}

/**
 * Hook for managing form submission loading states
 */
export function useFormSubmission<T>(
  submitFunction: (data: T) => Promise<void>,
  options: Omit<UseAsyncOperationOptions, 'category'> & {
    resetForm?: () => void;
    redirectAfterSuccess?: string;
  } = {}
) {
  const { resetForm, redirectAfterSuccess, ...asyncOptions } = options;

  const { execute, isActive } = useAsyncOperation(
    async (data: T) => {
      await submitFunction(data);

      if (resetForm) {
        resetForm();
      }

      if (redirectAfterSuccess && typeof window !== 'undefined') {
        window.location.href = redirectAfterSuccess;
      }
    },
    {
      ...asyncOptions,
      category: 'processing',
      loadingMessage: options.loadingMessage || 'Submitting form...'
    }
  );

  return {
    submitForm: execute,
    isSubmitting: isActive
  };
}
