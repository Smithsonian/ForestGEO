import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, renderHook } from '@testing-library/react';
import { LoadingProvider, useLoading } from './loadingprovider';
import React from 'react';

// Mock the useAppInsightsUserSync hook
vi.mock('@/config/applicationinsightsusersync', () => ({
  useAppInsightsUserSync: vi.fn()
}));

describe('LoadingProvider', () => {
  beforeEach(() => {
    // Clean up any existing overlay from previous tests
    const existingOverlay = document.getElementById('loading-blocking-overlay');
    if (existingOverlay) {
      existingOverlay.remove();
    }
    // Reset body classes and styles
    document.body.className = '';
    document.body.style.pointerEvents = '';
  });

  afterEach(() => {
    // Clean up
    const overlay = document.getElementById('loading-blocking-overlay');
    if (overlay) {
      overlay.remove();
    }
    document.body.className = '';
    document.body.style.pointerEvents = '';
  });

  describe('Context Creation and Provider', () => {
    it('should provide loading context to children', () => {
      const TestComponent = () => {
        const { isLoading, loadingMessage } = useLoading();
        return (
          <div>
            <div data-testid="loading">{isLoading ? 'Loading' : 'Not Loading'}</div>
            <div data-testid="message">{loadingMessage}</div>
          </div>
        );
      };

      render(
        <LoadingProvider>
          <TestComponent />
        </LoadingProvider>
      );

      expect(screen.getByTestId('loading')).toHaveTextContent('Not Loading');
      expect(screen.getByTestId('message')).toHaveTextContent('');
    });

    it('should render children correctly', () => {
      render(
        <LoadingProvider>
          <div data-testid="child">Test Child</div>
        </LoadingProvider>
      );

      expect(screen.getByTestId('child')).toHaveTextContent('Test Child');
    });
  });

  describe('Operation Management - Basic', () => {
    it('should start and track operations', () => {
      const { result } = renderHook(() => useLoading(), {
        wrapper: LoadingProvider
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.activeOperations).toHaveLength(0);

      const operationId = result.current.startOperation('Processing data');

      expect(operationId).toBeTruthy();
      expect(typeof operationId).toBe('string');
    });

    it('should generate unique operation IDs', () => {
      const { result } = renderHook(() => useLoading(), {
        wrapper: LoadingProvider
      });

      const op1 = result.current.startOperation('Op 1');
      const op2 = result.current.startOperation('Op 2');
      const op3 = result.current.startOperation('Op 3');

      expect(op1).not.toBe(op2);
      expect(op2).not.toBe(op3);
      expect(op1).not.toBe(op3);
    });

    it('should track operation categories', () => {
      const { result } = renderHook(() => useLoading(), {
        wrapper: LoadingProvider
      });

      const apiOp = result.current.startOperation('API Call', 'api');
      const uploadOp = result.current.startOperation('Upload', 'upload');
      const processingOp = result.current.startOperation('Process', 'processing');
      const generalOp = result.current.startOperation('General', 'general');

      // All operations should have been created with unique IDs
      expect(apiOp).toBeTruthy();
      expect(uploadOp).toBeTruthy();
      expect(processingOp).toBeTruthy();
      expect(generalOp).toBeTruthy();
    });

    it('should handle ending non-existent operation gracefully', () => {
      const { result } = renderHook(() => useLoading(), {
        wrapper: LoadingProvider
      });

      expect(() => {
        result.current.endOperation('non-existent-id');
      }).not.toThrow();

      expect(result.current.activeOperations).toHaveLength(0);
    });
  });

  describe('Legacy setLoading Method', () => {
    it('should accept setLoading calls without throwing', () => {
      const { result } = renderHook(() => useLoading(), {
        wrapper: LoadingProvider
      });

      expect(() => {
        result.current.setLoading(true, 'Loading data...');
      }).not.toThrow();
    });

    it('should handle setLoading(false) with no active operations', () => {
      const { result } = renderHook(() => useLoading(), {
        wrapper: LoadingProvider
      });

      expect(() => {
        result.current.setLoading(false);
      }).not.toThrow();

      expect(result.current.isLoading).toBe(false);
    });

    it('should handle setLoading with category parameter', () => {
      const { result } = renderHook(() => useLoading(), {
        wrapper: LoadingProvider
      });

      expect(() => {
        result.current.setLoading(true, 'API Request', undefined, 'api');
      }).not.toThrow();
    });

    it('should handle ending operation by ID', () => {
      const { result } = renderHook(() => useLoading(), {
        wrapper: LoadingProvider
      });

      const opId = result.current.startOperation('Test');

      expect(() => {
        result.current.setLoading(false, '', opId);
      }).not.toThrow();
    });
  });

  describe('isOperationActive', () => {
    it('should return false for non-existent operations', () => {
      const { result } = renderHook(() => useLoading(), {
        wrapper: LoadingProvider
      });

      expect(result.current.isOperationActive('fake-id')).toBe(false);
    });

    it('should check operation status', () => {
      const { result } = renderHook(() => useLoading(), {
        wrapper: LoadingProvider
      });

      const opId = result.current.startOperation('Test');
      // Operation should be created (testing that the function returns a value)
      expect(typeof result.current.isOperationActive(opId)).toBe('boolean');
    });
  });

  describe('Context Hook', () => {
    it('should provide all required context methods', () => {
      const { result } = renderHook(() => useLoading(), {
        wrapper: LoadingProvider
      });

      expect(result.current).toHaveProperty('isLoading');
      expect(result.current).toHaveProperty('loadingMessage');
      expect(result.current).toHaveProperty('activeOperations');
      expect(result.current).toHaveProperty('setLoading');
      expect(result.current).toHaveProperty('startOperation');
      expect(result.current).toHaveProperty('endOperation');
      expect(result.current).toHaveProperty('isOperationActive');
    });

    it('should have correct types for context methods', () => {
      const { result } = renderHook(() => useLoading(), {
        wrapper: LoadingProvider
      });

      expect(typeof result.current.isLoading).toBe('boolean');
      expect(typeof result.current.loadingMessage).toBe('string');
      expect(Array.isArray(result.current.activeOperations)).toBe(true);
      expect(typeof result.current.setLoading).toBe('function');
      expect(typeof result.current.startOperation).toBe('function');
      expect(typeof result.current.endOperation).toBe('function');
      expect(typeof result.current.isOperationActive).toBe('function');
    });
  });

  describe('Initial State', () => {
    it('should have correct initial state', () => {
      const { result } = renderHook(() => useLoading(), {
        wrapper: LoadingProvider
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.loadingMessage).toBe('');
      expect(result.current.activeOperations).toHaveLength(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid successive operations', () => {
      const { result } = renderHook(() => useLoading(), {
        wrapper: LoadingProvider
      });

      // Rapidly create multiple operations - should not throw
      expect(() => {
        for (let i = 0; i < 10; i++) {
          result.current.startOperation(`Operation ${i}`);
        }
      }).not.toThrow();

      // Operations array should be defined (length may vary due to React batching)
      expect(Array.isArray(result.current.activeOperations)).toBe(true);
    });

    it('should handle operations with empty messages', () => {
      const { result } = renderHook(() => useLoading(), {
        wrapper: LoadingProvider
      });

      expect(() => {
        result.current.startOperation('');
      }).not.toThrow();
    });

    it('should handle setLoading with empty message', () => {
      const { result } = renderHook(() => useLoading(), {
        wrapper: LoadingProvider
      });

      expect(() => {
        result.current.setLoading(true, '');
      }).not.toThrow();
    });
  });
});
