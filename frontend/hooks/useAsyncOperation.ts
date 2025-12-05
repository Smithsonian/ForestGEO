'use client';

import { useCallback, useRef, useEffect } from 'react';
import { useLoading } from '@/app/contexts/loadingprovider';

interface UseAsyncOperationOptions<R> {
  loadingMessage?: string;
  category?: 'api' | 'upload' | 'processing' | 'general';
  onSuccess?: (result: R) => void;
  onError?: (error: Error) => void;
  preventDuplicates?: boolean;
}

/**
 * Hook for managing async operations with automatic loading states
 * Provides operation deduplication, error handling, and loading state management
 */
export function useAsyncOperation<T extends unknown[], R>(asyncFunction: (...args: T) => Promise<R>, options: UseAsyncOperationOptions<R> = {}) {
  const { loadingMessage = 'Processing...', category = 'general', onSuccess, onError, preventDuplicates = true } = options;

  const { startOperation, endOperation, isOperationActive } = useLoading();
  const activeOperationRef = useRef<string | null>(null);
  const lastArgsRef = useRef<string | null>(null);
  // Track pending cache clear timeouts for proper cleanup
  const cacheTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Track if component is still mounted to prevent state updates after unmount
  const isMountedRef = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Clear any pending cache timeout
      if (cacheTimeoutRef.current) {
        clearTimeout(cacheTimeoutRef.current);
        cacheTimeoutRef.current = null;
      }
      // Clear refs to allow garbage collection
      activeOperationRef.current = null;
      lastArgsRef.current = null;
    };
  }, []);

  const execute = useCallback(
    async (...args: T): Promise<R | undefined> => {
      try {
        // Prevent duplicate operations if requested
        if (preventDuplicates) {
          const argsKey = JSON.stringify(args);

          // Check if same operation is already running (check ref first to prevent race condition)
          if (activeOperationRef.current) {
            // Either it's a pending marker or an active operation
            if (activeOperationRef.current.startsWith('pending:') || isOperationActive(activeOperationRef.current)) {
              // Silently prevent duplicates - don't spam console in StrictMode
              return;
            }
          }

          // Set pending marker IMMEDIATELY to prevent race condition with concurrent calls
          activeOperationRef.current = `pending:${loadingMessage}`;

          // Check if same arguments were used recently (only for non-data loading operations)
          if (lastArgsRef.current === argsKey && !loadingMessage.toLowerCase().includes('loading')) {
            activeOperationRef.current = null;
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

          // Handle success (only if still mounted)
          if (isMountedRef.current && onSuccess) {
            onSuccess(result);
          }

          return result;
        } catch (error) {
          // Handle error
          const errorObj = error instanceof Error ? error : new Error(String(error));
          console.error(`Operation failed: ${loadingMessage}`, errorObj);

          if (isMountedRef.current && onError) {
            onError(errorObj);
          } else if (isMountedRef.current) {
            // Default error handling - only if mounted
            alert(`Operation failed: ${errorObj.message}`);
          }

          throw errorObj;
        } finally {
          // Always end the operation
          endOperation(operationId);
          activeOperationRef.current = null;

          // Clear args cache after a delay to allow for legitimate re-runs
          // Track the timeout so we can clean it up on unmount
          if (preventDuplicates) {
            // Clear any existing timeout first
            if (cacheTimeoutRef.current) {
              clearTimeout(cacheTimeoutRef.current);
            }
            cacheTimeoutRef.current = setTimeout(() => {
              // Only clear if still mounted
              if (isMountedRef.current) {
                lastArgsRef.current = null;
              }
              cacheTimeoutRef.current = null;
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
    <T extends unknown[], R>(
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
  options: Omit<UseAsyncOperationOptions<void>, 'category'> & {
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
