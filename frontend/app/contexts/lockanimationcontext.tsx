'use client';
import React, { createContext, useContext, useState, ReactNode } from 'react';

interface LockAnimationContextProps {
  isPulsing: boolean;
  triggerPulse: () => void;
}

const LockAnimationContext = createContext<LockAnimationContextProps | undefined>(undefined);

export const LockAnimationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isPulsing, setIsPulsing] = useState(false);

  const triggerPulse = () => {
    setIsPulsing(true);
    setTimeout(() => {
      setIsPulsing(false);
    }, 5000);
  };

  return <LockAnimationContext.Provider value={{ isPulsing, triggerPulse }}>{children}</LockAnimationContext.Provider>;
};

export const useLockAnimation = () => {
  const context = useContext(LockAnimationContext);
  if (context === undefined) {
    throw new Error('useLockAnimation must be used within a LockAnimationProvider');
  }
  return context;
};
