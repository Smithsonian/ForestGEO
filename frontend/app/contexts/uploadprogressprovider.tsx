'use client';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

interface UploadProgress {
  fileID: string | null;
  progress: number;
  isRunning: boolean;
  startPolling: (fileID: string, schema: string) => void;
}

const UploadProgressContext = createContext<UploadProgress | undefined>(undefined);

export function UploadProgressProvider({ children }: { children: React.ReactNode }) {
  const [fileID, setFileID] = useState<string | null>(null);
  const [schema, setSchema] = useState<string | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const startPolling = useCallback((newFileID: string, newSchema: string) => {
    if (pollingRef.current) {
      console.warn('Polling is already active! Stopping previous polling before starting a new one.');
      clearInterval(pollingRef.current);
    }

    console.log(`Polling started for fileID: ${newFileID}`);
    setFileID(newFileID);
    setSchema(newSchema);
    setProgress(0);
    setIsRunning(true);
  }, []);

  // Cleanup when component unmounts
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (isRunning && fileID && schema) {
      pollingRef.current = setInterval(async () => {
        console.log(`Polling API call for fileID: ${fileID}`);
        try {
          const response = await fetch(`/api/polluploadprogress/${fileID}?schema=${schema}`);
          const { progress: newProgress } = await response.json();

          setProgress(newProgress);

          if (newProgress >= 100) {
            console.log(`Polling completed for fileID: ${fileID}`);
            setIsRunning(false);
            clearInterval(pollingRef.current!);
            pollingRef.current = null;

            setTimeout(() => {
              setFileID(null);
              setSchema(null);
              setProgress(0);
            }, 2000);
          }
        } catch (e) {
          console.error(`Error polling upload progress for ${fileID}:`, e);
        }
      }, 2000);
    }
  }, [isRunning, fileID, schema]);

  return <UploadProgressContext.Provider value={{ fileID, progress, isRunning, startPolling }}>{children}</UploadProgressContext.Provider>;
}

export function useUploadProgress() {
  const context = useContext(UploadProgressContext);
  if (!context) throw new Error('UploadProgressProvider must wrap the component tree.');
  return context;
}
