'use client';
import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

interface LockAnimationContextProps {
  isPulsing: boolean;
  triggerPulse: () => void;
}

const LockAnimationContext = createContext<LockAnimationContextProps | undefined>(undefined);

export const LockAnimationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isPulsing, setIsPulsing] = useState(false);
  const pulseTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Stable triggerPulse function that won't cause re-renders
  const triggerPulse = useCallback(() => {
    // Clear any existing timeout to prevent memory leaks
    if (pulseTimeoutRef.current) {
      clearTimeout(pulseTimeoutRef.current);
    }

    setIsPulsing(true);
    pulseTimeoutRef.current = setTimeout(() => {
      setIsPulsing(false);
      pulseTimeoutRef.current = null;
    }, 5000);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (pulseTimeoutRef.current) {
        clearTimeout(pulseTimeoutRef.current);
      }
    };
  }, []);

  // Memoize context value to prevent unnecessary re-renders of consumers
  const contextValue = useMemo(() => ({ isPulsing, triggerPulse }), [isPulsing, triggerPulse]);

  return <LockAnimationContext.Provider value={contextValue}>{children}</LockAnimationContext.Provider>;
};

export const useLockAnimation = () => {
  const context = useContext(LockAnimationContext);
  if (context === undefined) {
    throw new Error('useLockAnimation must be used within a LockAnimationProvider');
  }
  return context;
};
