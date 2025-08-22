'use client';

import React, { createContext, useContext, useState } from 'react';

/**
 * MEASUREMENTS UPLOAD COMPLETION CONTEXT
 *
 * This context is specifically designed for tracking measurements upload completion
 * and subsequent backend processing progress. It provides a centralized way to:
 * 1. Signal when measurements uploads complete successfully
 * 2. Track real-time backend processing progress via SSE streams
 * 3. Manage UI state for progress bars and completion notifications
 *
 * NOTE: This is measurements-specific only - other upload types should create
 * their own contexts rather than extending this one.
 */

/**
 * Data structure containing information about a completed measurements upload
 * Used to trigger backend processing and provide context for API calls
 */
interface MeasurementsUploadData {
  plotID?: number; // The plot where measurements were uploaded
  censusID?: number; // The census ID for the measurements
  plotCensusNumber?: number; // The plot census number (required by ingestionprocessor)
  schemaName?: string; // Database schema name for the measurements
  timestamp: string; // ISO timestamp when upload completed
}

/**
 * Real-time progress tracking for backend measurements processing
 * Updated via SSE events from the ingestionprocessor function app
 */
interface ProcessingProgress {
  isProcessing: boolean; // Whether backend processing is currently running
  totalBatches: number; // Total number of file batches to process
  completedBatches: number; // Number of batches completed so far
  currentFileID?: string; // ID of the file currently being processed
  currentBatchID?: string; // ID of the batch currently being processed
  error?: string; // Error message if processing fails
}

/**
 * React Context for managing measurements upload completion and processing state
 * Provides centralized state management for the entire measurements upload -> processing flow
 */
const MeasurementsUploadCompletionContext = createContext<{
  // Upload completion state
  measurementsUploadCompleted: boolean; // Flag indicating upload finished
  measurementsUploadData: MeasurementsUploadData | null; // Data from completed upload

  // Backend processing state
  processingProgress: ProcessingProgress; // Real-time processing progress
  processingCompleted: boolean; // Flag indicating processing finished

  // State management functions
  triggerMeasurementsUploadCompletion: (data: MeasurementsUploadData) => void; // Called when upload completes
  resetMeasurementsUploadCompletion: () => void; // Resets all state to initial values
  updateProcessingProgress: (progress: Partial<ProcessingProgress>) => void; // Updates processing progress
  setProcessingCompleted: (completed: boolean) => void; // Sets processing completion flag
}>({
  // Default values - these are used before the provider is mounted
  measurementsUploadCompleted: false,
  measurementsUploadData: null,
  processingProgress: { isProcessing: false, totalBatches: 0, completedBatches: 0 },
  processingCompleted: false,
  triggerMeasurementsUploadCompletion: () => {},
  resetMeasurementsUploadCompletion: () => {},
  updateProcessingProgress: () => {},
  setProcessingCompleted: () => {}
});

/**
 * MEASUREMENTS UPLOAD COMPLETION PROVIDER COMPONENT
 *
 * This provider component wraps the app and provides measurements upload completion
 * and processing state to all child components. It manages the entire lifecycle from
 * upload completion through backend processing completion.
 *
 * USAGE:
 * - Wrap your app with this provider (typically in layout.tsx)
 * - Components can access state via useMeasurementsUploadCompletion() hook
 * - Upload components call triggerMeasurementsUploadCompletion() when done
 * - Hub layout listens for state changes and starts backend processing
 * - UI components show progress and completion notifications
 */
export function MeasurementsUploadCompletionProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  // Core upload completion state
  const [measurementsUploadCompleted, setMeasurementsUploadCompleted] = useState(false);
  const [measurementsUploadData, setMeasurementsUploadData] = useState<MeasurementsUploadData | null>(null);

  // Backend processing progress state
  const [processingProgress, setProcessingProgress] = useState<ProcessingProgress>({
    isProcessing: false,
    totalBatches: 0,
    completedBatches: 0
  });

  // Processing completion state
  const [processingCompleted, setProcessingCompleted] = useState(false);

  /**
   * Called by upload components when measurements upload completes successfully
   * This triggers the entire processing workflow
   * @param data Upload completion data containing plot, census, and schema info
   */
  const triggerMeasurementsUploadCompletion = (data: MeasurementsUploadData) => {
    setMeasurementsUploadData(data);
    setMeasurementsUploadCompleted(true);
  };

  /**
   * Resets all state back to initial values
   * Called after processing completes or encounters errors
   * Clears upload data, processing progress, and completion flags
   */
  const resetMeasurementsUploadCompletion = () => {
    setMeasurementsUploadCompleted(false);
    setMeasurementsUploadData(null);
    setProcessingProgress({ isProcessing: false, totalBatches: 0, completedBatches: 0 });
    setProcessingCompleted(false);
  };

  /**
   * Updates processing progress with partial data
   * Called by SSE event handlers to update progress in real-time
   * @param progress Partial progress object - only updates provided fields
   */
  const updateProcessingProgress = (progress: Partial<ProcessingProgress>) => {
    setProcessingProgress(prev => ({ ...prev, ...progress }));
  };

  // Provide all state and functions to child components
  return (
    <MeasurementsUploadCompletionContext.Provider
      value={{
        measurementsUploadCompleted,
        measurementsUploadData,
        processingProgress,
        processingCompleted,
        triggerMeasurementsUploadCompletion,
        resetMeasurementsUploadCompletion,
        updateProcessingProgress,
        setProcessingCompleted
      }}
    >
      {children}
    </MeasurementsUploadCompletionContext.Provider>
  );
}

/**
 * CUSTOM HOOK FOR ACCESSING MEASUREMENTS UPLOAD COMPLETION CONTEXT
 *
 * This hook provides access to the measurements upload completion context.
 * Must be used within a MeasurementsUploadCompletionProvider.
 *
 * USAGE:
 * const { measurementsUploadCompleted, triggerMeasurementsUploadCompletion } = useMeasurementsUploadCompletion();
 *
 * @returns Context object with all state and functions
 * @throws Error if used outside of provider
 */
export const useMeasurementsUploadCompletion = () => {
  const context = useContext(MeasurementsUploadCompletionContext);
  if (!context) {
    throw new Error('useMeasurementsUploadCompletion must be used within a MeasurementsUploadCompletionProvider');
  }
  return context;
};
