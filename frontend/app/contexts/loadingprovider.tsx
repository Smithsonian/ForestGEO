'use client';

import React, { createContext, useContext, useState } from 'react';

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

  const setLoading = (isLoading: boolean, message = '') => {
    setIsLoading(isLoading);
    setLoadingMessage(message);
  };

  return <LoadingContext.Provider value={{ isLoading, loadingMessage, setLoading }}>{children}</LoadingContext.Provider>;
}

export const useLoading = () => useContext(LoadingContext);
