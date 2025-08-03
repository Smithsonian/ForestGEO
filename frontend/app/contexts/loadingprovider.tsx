'use client';

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAppInsightsUserSync } from '@/config/applicationinsightsusersync';

const LoadingContext = createContext<{
  isLoading: boolean;
  loadingMessage: string;
  setLoading: (isLoading: boolean, loadingMessage?: string) => void;
}>({
  isLoading: false,
  loadingMessage: '',
  setLoading: () => {}
});

export function LoadingProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const startTimeRef = useRef<number | null>(null); // Persistent reference for start time
  useAppInsightsUserSync();

  const setLoading = (isLoading: boolean, message = '') => {
    if (isLoading) {
      startTimeRef.current = Date.now(); // Record start time when loading begins
    } else {
      startTimeRef.current = null; // Clear start time when loading ends
    }
    setIsLoading(isLoading);
    setLoadingMessage(message);
  };

  useEffect(() => {
    if (isLoading) {
      document.body.classList.add('cursor-wait');
    } else {
      if (startTimeRef.current) {
        const duration = (Date.now() - startTimeRef.current) / 1000;
        startTimeRef.current = null; // Reset start time after usage

        // Simulate a delay to append duration to the message
        new Promise(resolve => setTimeout(resolve, 1000)).then(() => {
          setLoadingMessage(prev => `Completed in ${duration.toFixed(2)} seconds: ${prev}`);
        });
      }
      document.body.classList.remove('cursor-wait');
    }

    // Cleanup: ensure no lingering class on unmount
    return () => {
      document.body.classList.remove('cursor-wait');
    };
  }, [isLoading]);

  return <LoadingContext.Provider value={{ isLoading, loadingMessage, setLoading }}>{children}</LoadingContext.Provider>;
}

export const useLoading = () => useContext(LoadingContext);
