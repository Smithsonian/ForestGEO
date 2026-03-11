/**
 * useUploadSession Hook
 *
 * Provides client-side upload session management with:
 * - Automatic heartbeat to keep session alive
 * - Cleanup on unmount or browser close
 * - Session state synchronization
 * - Reconnection handling
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import ailogger from '@/ailogger';

export interface UploadSessionState {
  sessionId: string | null;
  state: string | null;
  uploadedChunks: number;
  processedBatches: number;
  totalBatches: number;
  isActive: boolean;
  error: string | null;
}

export interface UseUploadSessionOptions {
  schema: string;
  plotId: number;
  censusId: number;
  userId?: string; // Optional - will use 'anonymous' if not provided
  heartbeatInterval?: number; // Default: 30000ms (30 seconds)
  onSessionExpired?: () => void;
  onHeartbeatFailed?: (error: Error) => void;
}

export interface UseUploadSessionReturn {
  sessionId: string | null;
  session: UploadSessionState;
  isSessionActive: boolean;
  getCurrentSessionId: () => string | null;
  createSession: (fileId: string, totalChunks?: number, fileHash?: string) => Promise<string | null>;
  updateProgress: (updates: { uploadedChunks?: number; processedBatches?: number; totalBatches?: number; state?: string }) => Promise<void>;
  updateState: (state: string, errorMessage?: string) => Promise<void>;
  completeSession: () => Promise<void>;
  cancelSession: (cleanup?: boolean) => Promise<void>;
  sendManualHeartbeat: () => Promise<boolean>;
  isSessionValid: () => boolean;
}

const HEARTBEAT_INTERVAL_DEFAULT = 30000; // 30 seconds

export function useUploadSession(options: UseUploadSessionOptions): UseUploadSessionReturn {
  const { schema, plotId, censusId, userId = 'anonymous', heartbeatInterval = HEARTBEAT_INTERVAL_DEFAULT, onSessionExpired, onHeartbeatFailed } = options;

  const [session, setSession] = useState<UploadSessionState>({
    sessionId: null,
    state: null,
    uploadedChunks: 0,
    processedBatches: 0,
    totalBatches: 0,
    isActive: false,
    error: null
  });

  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);
  const consecutiveHeartbeatFailures = useRef(0);
  const MAX_HEARTBEAT_FAILURES = 3;

  /**
   * Send heartbeat to server
   */
  const sendHeartbeat = useCallback(async (): Promise<boolean> => {
    // Skip heartbeat if session is already cleared (completed/abandoned/unmounting)
    if (!sessionIdRef.current || !isMountedRef.current) return false;

    try {
      const response = await fetch('/api/uploadsession', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schema,
          sessionId: sessionIdRef.current,
          action: 'heartbeat'
        })
      });

      if (response.ok) {
        consecutiveHeartbeatFailures.current = 0;
        return true;
      }

      // Session not found or expired
      if (response.status === 404) {
        ailogger.warn('[useUploadSession] Session expired or not found');
        consecutiveHeartbeatFailures.current++;
        if (consecutiveHeartbeatFailures.current >= MAX_HEARTBEAT_FAILURES) {
          if (isMountedRef.current) {
            setSession(prev => ({ ...prev, isActive: false, error: 'Session expired' }));
          }
          onSessionExpired?.();
        }
        return false;
      }

      consecutiveHeartbeatFailures.current++;
      return false;
    } catch (error: unknown) {
      // Ignore errors when component is unmounting (aborted requests)
      if (!isMountedRef.current) return false;

      consecutiveHeartbeatFailures.current++;
      ailogger.warn('[useUploadSession] Heartbeat failed:', error instanceof Error ? error : new Error(String(error)));
      onHeartbeatFailed?.(error instanceof Error ? error : new Error(String(error)));

      if (consecutiveHeartbeatFailures.current >= MAX_HEARTBEAT_FAILURES) {
        if (isMountedRef.current) {
          setSession(prev => ({ ...prev, isActive: false, error: 'Lost connection to server' }));
        }
        onSessionExpired?.();
      }
      return false;
    }
  }, [schema, onSessionExpired, onHeartbeatFailed]);

  /**
   * Start heartbeat interval
   */
  const startHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
    }

    heartbeatIntervalRef.current = setInterval(() => {
      sendHeartbeat();
    }, heartbeatInterval);

    ailogger.info(`[useUploadSession] Started heartbeat interval (${heartbeatInterval}ms)`);
  }, [heartbeatInterval, sendHeartbeat]);

  /**
   * Stop heartbeat interval
   */
  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
      ailogger.info('[useUploadSession] Stopped heartbeat interval');
    }
  }, []);

  /**
   * Create a new upload session
   */
  const createSession = useCallback(
    async (fileId: string, totalChunks: number = 0, fileHash?: string): Promise<string | null> => {
      try {
        const response = await fetch('/api/uploadsession', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            schema,
            plotId,
            censusId,
            userId,
            fileId,
            totalChunks,
            fileHash
          })
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to create session');
        }

        const data = await response.json();
        const newSession = data.session;

        sessionIdRef.current = newSession.sessionId;
        consecutiveHeartbeatFailures.current = 0;

        if (isMountedRef.current) {
          setSession({
            sessionId: newSession.sessionId,
            state: newSession.state,
            uploadedChunks: newSession.uploadedChunks || 0,
            processedBatches: newSession.processedBatches || 0,
            totalBatches: newSession.totalBatches || 0,
            isActive: true,
            error: null
          });
        }

        // Start heartbeat
        startHeartbeat();

        ailogger.info(`[useUploadSession] Created session: ${newSession.sessionId}`);
        return newSession.sessionId;
      } catch (error: any) {
        ailogger.error('[useUploadSession] Failed to create session:', error);
        if (isMountedRef.current) {
          setSession(prev => ({ ...prev, error: error.message }));
        }
        return null;
      }
    },
    [schema, plotId, censusId, userId, startHeartbeat]
  );

  /**
   * Update session progress
   */
  const updateProgress = useCallback(
    async (updates: { uploadedChunks?: number; processedBatches?: number; totalBatches?: number; state?: string }): Promise<void> => {
      if (!sessionIdRef.current) return;

      try {
        await fetch('/api/uploadsession', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            schema,
            sessionId: sessionIdRef.current,
            action: 'updateProgress',
            ...updates
          })
        });

        if (isMountedRef.current) {
          setSession(prev => ({
            ...prev,
            uploadedChunks: updates.uploadedChunks ?? prev.uploadedChunks,
            processedBatches: updates.processedBatches ?? prev.processedBatches,
            totalBatches: updates.totalBatches ?? prev.totalBatches,
            state: updates.state ?? prev.state
          }));
        }
      } catch (error: unknown) {
        ailogger.error('[useUploadSession] Failed to update progress:', error instanceof Error ? error : new Error(String(error)));
      }
    },
    [schema]
  );

  /**
   * Update session state
   */
  const updateState = useCallback(
    async (state: string, errorMessage?: string): Promise<void> => {
      if (!sessionIdRef.current) return;

      try {
        const response = await fetch('/api/uploadsession', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            schema,
            sessionId: sessionIdRef.current,
            action: 'updateState',
            state,
            errorMessage
          })
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || `Failed to update upload session state to ${state}`);
        }

        if (isMountedRef.current) {
          setSession(prev => ({ ...prev, state, error: errorMessage || prev.error }));
        }

        // Stop heartbeat and clear session ref if session is terminal
        // Clearing the ref prevents unmount cleanup from re-marking as abandoned
        if (['completed', 'failed', 'abandoned', 'cleaned_up'].includes(state)) {
          stopHeartbeat();
          sessionIdRef.current = null; // Clear to prevent unmount cleanup from overwriting terminal state
          if (isMountedRef.current) {
            setSession(prev => ({ ...prev, isActive: false }));
          }
        }
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        ailogger.error('[useUploadSession] Failed to update state:', err);
        if (isMountedRef.current) {
          setSession(prev => ({ ...prev, error: err.message }));
        }
        throw err;
      }
    },
    [schema, stopHeartbeat]
  );

  /**
   * Cancel/abandon the session
   */
  const cancelSession = useCallback(
    async (cleanup: boolean = false): Promise<void> => {
      if (!sessionIdRef.current) return;

      try {
        stopHeartbeat();

        await fetch(`/api/uploadsession?schema=${schema}&sessionId=${sessionIdRef.current}&cleanup=${cleanup}`, {
          method: 'DELETE'
        });

        sessionIdRef.current = null;

        if (isMountedRef.current) {
          setSession({
            sessionId: null,
            state: 'abandoned',
            uploadedChunks: 0,
            processedBatches: 0,
            totalBatches: 0,
            isActive: false,
            error: null
          });
        }

        ailogger.info('[useUploadSession] Session cancelled');
      } catch (error: unknown) {
        ailogger.error('[useUploadSession] Failed to cancel session:', error instanceof Error ? error : new Error(String(error)));
      }
    },
    [schema, stopHeartbeat]
  );

  /**
   * Complete the session (mark as completed and stop heartbeat)
   */
  const completeSession = useCallback(async (): Promise<void> => {
    await updateState('completed');
    stopHeartbeat();
  }, [updateState, stopHeartbeat]);

  /**
   * Check if session is valid
   */
  const isSessionValid = useCallback((): boolean => {
    return !!sessionIdRef.current && session.isActive && !session.error;
  }, [session.isActive, session.error]);

  const getCurrentSessionId = useCallback((): string | null => {
    return sessionIdRef.current;
  }, []);

  /**
   * Handle page visibility change (pause/resume heartbeat)
   */
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Page is hidden, but keep heartbeat running to maintain session
        ailogger.info('[useUploadSession] Page hidden, heartbeat continues');
      } else {
        // Page is visible again, send immediate heartbeat
        if (sessionIdRef.current) {
          sendHeartbeat();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [sendHeartbeat]);

  /**
   * Handle beforeunload - warn user if upload in progress
   */
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (sessionIdRef.current && session.isActive) {
        // Standard way to trigger browser's "are you sure?" dialog
        event.preventDefault();
        event.returnValue = 'Upload in progress. Are you sure you want to leave?';

        // Try to send a final heartbeat/abandon signal
        // Note: This is best-effort as page may close before it completes
        if (navigator.sendBeacon) {
          const data = JSON.stringify({
            schema,
            sessionId: sessionIdRef.current,
            action: 'updateState',
            state: 'abandoned',
            errorMessage: 'User closed browser during upload'
          });
          navigator.sendBeacon('/api/uploadsession', new Blob([data], { type: 'application/json' }));
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [schema, session.isActive]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      stopHeartbeat();

      // Mark session as abandoned if still active
      if (sessionIdRef.current) {
        const sessionId = sessionIdRef.current;
        // Fire-and-forget cleanup. This is especially important during development,
        // where Fast Refresh can unmount the uploader mid-file and otherwise leave
        // partial temporary rows behind for the next retry.
        fetch(`/api/uploadsession?schema=${schema}&sessionId=${sessionId}&cleanup=true`, {
          method: 'DELETE',
          keepalive: true
        }).catch(() => {
          // Ignore errors on cleanup
        });
      }
    };
  }, [schema, stopHeartbeat]);

  return {
    sessionId: session.sessionId,
    session,
    isSessionActive: session.isActive,
    getCurrentSessionId,
    createSession,
    updateProgress,
    updateState,
    completeSession,
    cancelSession,
    sendManualHeartbeat: sendHeartbeat,
    isSessionValid
  };
}
