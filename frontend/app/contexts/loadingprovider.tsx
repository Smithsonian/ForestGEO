'use client';

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useAppInsightsUserSync } from '@/config/applicationinsightsusersync';
import ailogger from '@/ailogger';

interface LoadingOperation {
  id: string;
  message: string;
  startTime: number;
  category?: 'api' | 'upload' | 'processing' | 'general';
}

interface LoadingContextType {
  isLoading: boolean;
  loadingMessage: string;
  activeOperations: LoadingOperation[];
  setLoading: (isLoading: boolean, loadingMessage?: string, operationId?: string, category?: LoadingOperation['category']) => void;
  startOperation: (message: string, category?: LoadingOperation['category']) => string;
  endOperation: (operationId: string) => void;
  isOperationActive: (operationId: string) => boolean;
}

const LoadingContext = createContext<LoadingContextType>({
  isLoading: false,
  loadingMessage: '',
  activeOperations: [],
  setLoading: () => {},
  startOperation: () => '',
  endOperation: () => {},
  isOperationActive: () => false
});

/**
 * GlobalLoadingProvider renders the full-screen blocking overlay.
 *
 * CONTRACT (post Phase 1 unified-loading migration): use only for destructive/blocking
 * mutations — delete, bulk upload, census creation, long-running reingest.
 * Reads (grid fetches, dashboard cards, autocompletes, selectors) must use
 * <LoadingBar/> or <ContentSkeleton/> from @/components/loading instead.
 * The 750ms minimum-display remains in place here to prevent overlay flicker on fast
 * destructive calls; it is deliberately absent from <LoadingBar/>.
 */
export function LoadingProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [activeOperations, setActiveOperations] = useState<LoadingOperation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const operationTimeoutRefs = useRef<Map<string, NodeJS.Timeout>>(new Map());
  // Use ref to avoid activeOperations in setLoading dependencies (prevents cascade rerenders)
  const activeOperationsRef = useRef<LoadingOperation[]>([]);
  useAppInsightsUserSync();

  // Generate unique operation ID
  const generateOperationId = useCallback(() => {
    return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  // End an operation
  const endOperation = useCallback((operationId: string) => {
    setActiveOperations(prev => {
      const updated = prev.filter(op => op.id !== operationId);
      // Synchronously update ref so isOperationActive returns correct value immediately
      activeOperationsRef.current = updated;
      return updated;
    });

    // Clear timeout
    const timeoutId = operationTimeoutRefs.current.get(operationId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      operationTimeoutRefs.current.delete(operationId);
    }
  }, []);

  // Start a new operation
  const startOperation = useCallback(
    (message: string, category: LoadingOperation['category'] = 'general') => {
      const operationId = generateOperationId();
      const operation: LoadingOperation = {
        id: operationId,
        message,
        startTime: Date.now(),
        category
      };

      setActiveOperations(prev => {
        const updated = [...prev, operation];
        // Synchronously update ref so isOperationActive returns correct value immediately
        activeOperationsRef.current = updated;
        return updated;
      });

      // Give long-running processing flows the same budget as uploads.
      const TIMEOUT_BY_CATEGORY_MS: Record<string, number> = {
        upload: 5 * 60 * 1000,
        processing: 5 * 60 * 1000,
        api: 60 * 1000
      };
      const DEFAULT_TIMEOUT_MS = 30 * 1000;
      const timeoutDuration = TIMEOUT_BY_CATEGORY_MS[category ?? ''] ?? DEFAULT_TIMEOUT_MS;
      const timeoutId = setTimeout(() => {
        ailogger.warn(`Operation ${operationId} timed out after ${timeoutDuration}ms`);
        endOperation(operationId);
      }, timeoutDuration);

      operationTimeoutRefs.current.set(operationId, timeoutId);

      return operationId;
    },
    [generateOperationId, endOperation]
  );

  // Check if operation is active - use ref to avoid dependency on activeOperations state
  // This prevents cascading re-renders when operations change
  const isOperationActive = useCallback((operationId: string) => {
    return activeOperationsRef.current.some(op => op.id === operationId);
  }, []);

  // Legacy setLoading method for backward compatibility
  const legacyOperationsRef = useRef<Map<string, string>>(new Map()); // message -> operationId

  const setLoading = useCallback(
    (isLoading: boolean, message = '', operationId?: string, category?: LoadingOperation['category']) => {
      if (isLoading && message) {
        if (!operationId) {
          // Check if we already have an operation for this message
          const existingOperationId = legacyOperationsRef.current.get(message);
          if (existingOperationId && isOperationActive(existingOperationId)) {
            // Operation already exists, don't create duplicate
            return;
          }

          // Start new operation and track it
          const newOperationId = startOperation(message, category);
          legacyOperationsRef.current.set(message, newOperationId);
        }
      } else if (!isLoading) {
        // End operation - either by operationId or by message
        if (operationId) {
          endOperation(operationId);
          // Remove from legacy tracking
          for (const [msg, opId] of legacyOperationsRef.current.entries()) {
            if (opId === operationId) {
              legacyOperationsRef.current.delete(msg);
              break;
            }
          }
        } else if (message) {
          // End operation by message
          const existingOperationId = legacyOperationsRef.current.get(message);
          if (existingOperationId) {
            endOperation(existingOperationId);
            legacyOperationsRef.current.delete(message);
          }
        } else {
          // Fallback: end the most recent operation if no identifier provided
          // Use ref instead of state to avoid dependency on activeOperations
          const lastOperation = activeOperationsRef.current[activeOperationsRef.current.length - 1];
          if (lastOperation) {
            endOperation(lastOperation.id);
            // Clean up from legacy tracking
            for (const [msg, opId] of legacyOperationsRef.current.entries()) {
              if (opId === lastOperation.id) {
                legacyOperationsRef.current.delete(msg);
                break;
              }
            }
          }
        }
      }
    },
    [startOperation, endOperation, isOperationActive]
  );

  // Keep ref in sync with state
  useEffect(() => {
    activeOperationsRef.current = activeOperations;
  }, [activeOperations]);

  // Update loading state based on active operations
  useEffect(() => {
    const hasActiveOperations = activeOperations.length > 0;
    setIsLoading(hasActiveOperations);

    if (hasActiveOperations) {
      // Show the most recent operation's message
      const latestOperation = activeOperations[activeOperations.length - 1];
      setLoadingMessage(latestOperation.message);
    } else {
      setLoadingMessage('');
    }
  }, [activeOperations]);

  // Apply UI blocking effects using CSS classes (no direct DOM manipulation)
  // The loading-blocked class is defined in globals.css and uses ::after pseudo-element
  // for the overlay, avoiding dynamic element creation and potential XSS vectors
  useEffect(() => {
    if (isLoading) {
      // Add CSS class that blocks interactions via pointer-events and adds cursor-wait
      // The ::after pseudo-element in CSS creates the overlay automatically
      document.body.classList.add('loading-blocked');
    } else {
      // Remove blocking class to re-enable interactions
      document.body.classList.remove('loading-blocked');
    }

    // Cleanup function - ensure class is removed on unmount
    return () => {
      document.body.classList.remove('loading-blocked');
    };
  }, [isLoading]);

  // Cleanup timeouts and legacy operations on unmount
  useEffect(() => {
    const timeoutRefs = operationTimeoutRefs.current;
    const legacyRefs = legacyOperationsRef.current;
    return () => {
      timeoutRefs.forEach(timeoutId => {
        clearTimeout(timeoutId);
      });
      timeoutRefs.clear();
      legacyRefs.clear();
    };
  }, []);

  // Periodic cleanup of stale operations (catches any that slip through)
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      const maxAge = 2 * 60 * 1000; // 2 minutes max age for any operation

      setActiveOperations(prev => {
        const validOperations = prev.filter(op => {
          const age = now - op.startTime;
          // Remove operations older than maxAge or with invalid timestamps
          if (age > maxAge || age < 0 || !op.startTime) {
            ailogger.warn(`Cleaning up stale operation: ${op.id} (${op.message}), age: ${age}ms`);
            // Also clear any associated timeout
            const timeoutId = operationTimeoutRefs.current.get(op.id);
            if (timeoutId) {
              clearTimeout(timeoutId);
              operationTimeoutRefs.current.delete(op.id);
            }
            return false;
          }
          return true;
        });

        // Only update if something was removed
        if (validOperations.length !== prev.length) {
          // Synchronously update ref
          activeOperationsRef.current = validOperations;
          return validOperations;
        }
        return prev;
      });
    }, 30000); // Check every 30 seconds

    return () => clearInterval(cleanupInterval);
  }, []);

  const contextValue: LoadingContextType = {
    isLoading,
    loadingMessage,
    activeOperations,
    setLoading,
    startOperation,
    endOperation,
    isOperationActive
  };

  return <LoadingContext.Provider value={contextValue}>{children}</LoadingContext.Provider>;
}

/** Use only for destructive/blocking mutations. See LoadingProvider for the full contract. */
export const useLoading = () => useContext(LoadingContext);
