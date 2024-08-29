'use client';

import React, { createContext, useContext, useState } from 'react';

const LoadingContext = createContext<{
  isLoading: boolean;
  loadingMessage: string;
  setLoading: (isLoading: boolean, loadingMessage?: string) => void;
  secondaryLoading: Record<string, boolean>;
  setSecondaryLoading: (key: string, isLoading: boolean) => void;
}>({
  isLoading: false,
  loadingMessage: '',
  setLoading: () => {},
  secondaryLoading: {},
  setSecondaryLoading: () => {}
});

export function LoadingProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [secondaryLoading, setSecondaryLoadingState] = useState<Record<string, boolean>>({});

  const setLoading = (isLoading: boolean, message = '') => {
    setIsLoading(isLoading);
    setLoadingMessage(message);
  };

  const setSecondaryLoading = (key: string, isLoading: boolean) => {
    setSecondaryLoadingState(prev => ({
      ...prev,
      [key]: isLoading
    }));
  };

  return <LoadingContext.Provider value={{ isLoading, loadingMessage, setLoading, secondaryLoading, setSecondaryLoading }}>{children}</LoadingContext.Provider>;
}

export const useLoading = () => useContext(LoadingContext);
