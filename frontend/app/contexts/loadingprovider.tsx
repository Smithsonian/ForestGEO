'use client';

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useAppInsightsUserSync } from '@/config/applicationinsightsusersync';

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

export function LoadingProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [activeOperations, setActiveOperations] = useState<LoadingOperation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const operationTimeoutRefs = useRef<Map<string, NodeJS.Timeout>>(new Map());
  useAppInsightsUserSync();

  // Generate unique operation ID
  const generateOperationId = useCallback(() => {
    return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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

      setActiveOperations(prev => [...prev, operation]);

      // Set up automatic timeout (30 seconds for most operations, 5 minutes for uploads)
      const timeoutDuration = category === 'upload' ? 5 * 60 * 1000 : 30 * 1000;
      const timeoutId = setTimeout(() => {
        console.warn(`Operation ${operationId} timed out after ${timeoutDuration}ms`);
        endOperation(operationId);
      }, timeoutDuration);

      operationTimeoutRefs.current.set(operationId, timeoutId);

      return operationId;
    },
    [generateOperationId]
  );

  // End an operation
  const endOperation = useCallback((operationId: string) => {
    setActiveOperations(prev => prev.filter(op => op.id !== operationId));

    // Clear timeout
    const timeoutId = operationTimeoutRefs.current.get(operationId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      operationTimeoutRefs.current.delete(operationId);
    }
  }, []);

  // Check if operation is active
  const isOperationActive = useCallback(
    (operationId: string) => {
      return activeOperations.some(op => op.id === operationId);
    },
    [activeOperations]
  );

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
          const lastOperation = activeOperations[activeOperations.length - 1];
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
    [startOperation, endOperation, isOperationActive, activeOperations]
  );

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

  // Apply UI blocking effects
  useEffect(() => {
    if (isLoading) {
      // Block all interactive elements
      document.body.classList.add('cursor-wait');
      document.body.style.pointerEvents = 'none';

      // Create overlay to catch any events that might slip through
      const blockingOverlay = document.createElement('div');
      blockingOverlay.id = 'loading-blocking-overlay';
      blockingOverlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 1999;
        background: transparent;
        pointer-events: auto;
        cursor: wait;
      `;

      // Prevent all interactions on the overlay
      const preventInteraction = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        return false;
      };

      ['click', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'keydown', 'keyup'].forEach(eventType => {
        blockingOverlay.addEventListener(eventType, preventInteraction, true);
      });

      document.body.appendChild(blockingOverlay);
    } else {
      // Re-enable interactions
      document.body.classList.remove('cursor-wait');
      document.body.style.pointerEvents = '';

      // Remove blocking overlay
      const blockingOverlay = document.getElementById('loading-blocking-overlay');
      if (blockingOverlay) {
        blockingOverlay.remove();
      }
    }

    // Cleanup function
    return () => {
      document.body.classList.remove('cursor-wait');
      document.body.style.pointerEvents = '';
      const blockingOverlay = document.getElementById('loading-blocking-overlay');
      if (blockingOverlay) {
        blockingOverlay.remove();
      }
    };
  }, [isLoading]);

  // Cleanup timeouts and legacy operations on unmount
  useEffect(() => {
    return () => {
      operationTimeoutRefs.current.forEach(timeoutId => {
        clearTimeout(timeoutId);
      });
      operationTimeoutRefs.current.clear();
      legacyOperationsRef.current.clear();
    };
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

export const useLoading = () => useContext(LoadingContext);
