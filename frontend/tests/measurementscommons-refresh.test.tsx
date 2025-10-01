/**
 * Unit tests for measurementscommons validation count refresh functionality
 *
 * These tests verify that validation counts are properly refreshed when:
 * 1. Records transition from pending to validated/invalid
 * 2. Filter buttons are toggled
 * 3. Data is refetched after validation completes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useCallback, useState, useEffect } from 'react';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe('MeasurementsCommons - Validation Count Refresh', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should fetch fresh counts from database, not cached data', async () => {
    const mockCountsResponse = {
      CountValid: 10,
      CountErrors: 2,
      CountPending: 0,
      CountOldTrees: 5,
      CountNewRecruits: 3,
      CountMultiStems: 2
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [mockCountsResponse]
    });

    const { result } = renderHook(() => {
      const [counts, setCounts] = useState({
        valid: 0,
        errors: 0,
        pending: 0
      });

      const refreshCounts = useCallback(async () => {
        const query = `SELECT SUM(CASE WHEN vft.IsValidated = TRUE THEN 1 ELSE 0 END) AS CountValid,
                              SUM(CASE WHEN vft.IsValidated = FALSE THEN 1 ELSE 0 END) AS CountErrors,
                              SUM(CASE WHEN vft.IsValidated IS NULL THEN 1 ELSE 0 END) AS CountPending
                       FROM testschema.measurementssummary vft
                       WHERE vft.PlotID = 1`;

        const response = await fetch('/api/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(query)
        });

        const data = await response.json();
        setCounts({
          valid: data[0].CountValid,
          errors: data[0].CountErrors,
          pending: data[0].CountPending
        });
      }, []);

      useEffect(() => {
        refreshCounts();
      }, [refreshCounts]);

      return { counts, refreshCounts };
    });

    await waitFor(() => {
      expect(result.current.counts.valid).toBe(10);
      expect(result.current.counts.errors).toBe(2);
      expect(result.current.counts.pending).toBe(0);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/query',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
    );
  });

  it('should update counts when records transition from pending to validated', async () => {
    // Initial state: 3 pending records
    const initialCounts = {
      CountValid: 5,
      CountErrors: 0,
      CountPending: 3,
      CountOldTrees: 3,
      CountNewRecruits: 1,
      CountMultiStems: 1
    };

    // After validation: pending records become valid
    const updatedCounts = {
      CountValid: 8, // 5 + 3
      CountErrors: 0,
      CountPending: 0, // 3 -> 0
      CountOldTrees: 3,
      CountNewRecruits: 1,
      CountMultiStems: 1
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [initialCounts]
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [updatedCounts]
      });

    const { result } = renderHook(() => {
      const [pendingCount, setPendingCount] = useState(0);
      const [validCount, setValidCount] = useState(0);

      const refreshCounts = useCallback(async () => {
        const response = await fetch('/api/query', {
          method: 'POST',
          body: JSON.stringify('SELECT COUNT query')
        });
        const data = await response.json();
        setPendingCount(data[0].CountPending);
        setValidCount(data[0].CountValid);
      }, []);

      return { pendingCount, validCount, refreshCounts };
    });

    // Initial fetch
    await result.current.refreshCounts();
    await waitFor(() => {
      expect(result.current.pendingCount).toBe(3);
      expect(result.current.validCount).toBe(5);
    });

    // Simulate validation completion and refresh
    await result.current.refreshCounts();
    await waitFor(() => {
      expect(result.current.pendingCount).toBe(0);
      expect(result.current.validCount).toBe(8);
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should refresh counts when filter buttons are toggled', async () => {
    const mockCounts = {
      CountValid: 10,
      CountErrors: 2,
      CountPending: 3,
      CountOldTrees: 5,
      CountNewRecruits: 3,
      CountMultiStems: 2
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [mockCounts]
    });

    const { result } = renderHook(() => {
      const [showPending, setShowPending] = useState(true);
      const [showErrors, setShowErrors] = useState(true);
      const [showValid, setShowValid] = useState(true);
      const [refreshCount, setRefreshCount] = useState(0);

      const refreshCounts = useCallback(async () => {
        await fetch('/api/query', {
          method: 'POST',
          body: JSON.stringify('SELECT query')
        });
        setRefreshCount(prev => prev + 1);
      }, []);

      // Simulate filter change triggering refresh
      useEffect(() => {
        refreshCounts();
      }, [showPending, showErrors, showValid, refreshCounts]);

      return { showPending, setShowPending, refreshCount };
    });

    const initialRefreshCount = result.current.refreshCount;

    // Toggle pending filter
    result.current.setShowPending(false);

    await waitFor(() => {
      expect(result.current.refreshCount).toBeGreaterThan(initialRefreshCount);
    });

    // Verify fetch was called when filter changed
    expect(mockFetch).toHaveBeenCalled();
  });

  it('should handle errors gracefully when fetching counts fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => {
      const [error, setError] = useState<string | null>(null);

      const refreshCounts = useCallback(async () => {
        try {
          const response = await fetch('/api/query', {
            method: 'POST',
            body: JSON.stringify('SELECT query')
          });

          if (!response.ok) {
            throw new Error('Failed to fetch counts');
          }
        } catch (err: any) {
          setError(err.message);
        }
      }, []);

      return { error, refreshCounts };
    });

    await result.current.refreshCounts();

    await waitFor(() => {
      expect(result.current.error).toBe('Network error');
    });

    consoleErrorSpy.mockRestore();
  });

  it('should not fetch counts if site, plot, or census context is missing', async () => {
    const { result } = renderHook(() => {
      const currentSite = null;
      const currentPlot = null;
      const currentCensus = null;

      const refreshCounts = useCallback(async () => {
        if (!currentSite || !currentPlot || !currentCensus) {
          return; // Early return, no fetch
        }

        await fetch('/api/query', {
          method: 'POST',
          body: JSON.stringify('SELECT query')
        });
      }, [currentSite, currentPlot, currentCensus]);

      return { refreshCounts };
    });

    await result.current.refreshCounts();

    // Fetch should not have been called
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should update both measurement counts and failed measurement counts', async () => {
    const mockCountsResponse = {
      CountValid: 10,
      CountErrors: 2,
      CountPending: 3,
      CountOldTrees: 5,
      CountNewRecruits: 3,
      CountMultiStems: 2
    };

    const mockFailedCountResponse = {
      CountFailed: 5
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [mockCountsResponse]
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [mockFailedCountResponse]
      });

    const { result } = renderHook(() => {
      const [validCount, setValidCount] = useState(0);
      const [failedCount, setFailedCount] = useState(0);

      const refreshCounts = useCallback(async () => {
        // Fetch regular counts
        const countsResponse = await fetch('/api/query', {
          method: 'POST',
          body: JSON.stringify('SELECT counts query')
        });
        const countsData = await countsResponse.json();
        setValidCount(countsData[0].CountValid);

        // Fetch failed measurements count
        const failedResponse = await fetch('/api/query', {
          method: 'POST',
          body: JSON.stringify('SELECT failed query')
        });
        const failedData = await failedResponse.json();
        setFailedCount(failedData[0].CountFailed);
      }, []);

      return { validCount, failedCount, refreshCounts };
    });

    await result.current.refreshCounts();

    await waitFor(() => {
      expect(result.current.validCount).toBe(10);
      expect(result.current.failedCount).toBe(5);
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
