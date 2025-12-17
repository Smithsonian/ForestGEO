'use client';

import React, { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { AnimationName, getAnimationPath, preloadAnimations } from '@/app/hooks/useAnimationCache';

/**
 * Animation Cache Context (Simplified)
 *
 * Provides a simple interface to get animation URLs and preloads them on login.
 * Uses direct public folder paths (/animations/) instead of API routes.
 *
 * The preloading warms the browser's HTTP cache, so animations load instantly
 * during upload operations.
 */

export interface AnimationCacheContextValue {
  /** Whether animations have been preloaded */
  isPreloaded: boolean;
  /** Get the URL for an animation */
  getAnimationUrl: (name: AnimationName) => string;
}

const AnimationCacheContext = createContext<AnimationCacheContextValue | null>(null);

interface AnimationCacheProviderProps {
  children: React.ReactNode;
}

export function AnimationCacheProvider({ children }: AnimationCacheProviderProps) {
  const { status: sessionStatus } = useSession();
  const [isPreloaded, setIsPreloaded] = useState(false);
  const preloadStartedRef = useRef(false);

  // Preload animations after authentication
  useEffect(() => {
    if (sessionStatus === 'authenticated' && !preloadStartedRef.current) {
      preloadStartedRef.current = true;

      // Preload in background - don't block rendering
      preloadAnimations()
        .then(() => {
          setIsPreloaded(true);
          console.log('[AnimationCache] Animations preloaded successfully');
        })
        .catch(err => {
          console.warn('[AnimationCache] Preload failed (animations will load on demand):', err);
          // Still mark as "preloaded" so we don't retry
          setIsPreloaded(true);
        });
    }
  }, [sessionStatus]);

  // Simple function to get animation URL - just returns the public path
  const getAnimationUrl = useCallback((name: AnimationName): string => {
    return getAnimationPath(name);
  }, []);

  const contextValue = useMemo<AnimationCacheContextValue>(
    () => ({
      isPreloaded,
      getAnimationUrl
    }),
    [isPreloaded, getAnimationUrl]
  );

  return <AnimationCacheContext.Provider value={contextValue}>{children}</AnimationCacheContext.Provider>;
}

/**
 * Hook to access the animation cache context
 */
export function useAnimationCacheContext(): AnimationCacheContextValue {
  const context = useContext(AnimationCacheContext);

  if (!context) {
    throw new Error('useAnimationCacheContext must be used within an AnimationCacheProvider');
  }

  return context;
}
