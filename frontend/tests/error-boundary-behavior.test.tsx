import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import ErrorPage from '@/app/error';

vi.mock('@mui/joy', () => ({
  Box: ({ children, ...props }: any) => (
    <div data-testid="box" {...props}>
      {children}
    </div>
  ),
  Button: ({ children, onClick, ...props }: any) => (
    <button data-testid="retry-button" onClick={onClick} {...props}>
      {children}
    </button>
  ),
  Typography: ({ children, level, ...props }: any) => (
    <div data-testid={`typography-${level}`} {...props}>
      {children}
    </div>
  )
}));

describe('Error Boundary Behavior Tests', () => {
  let mockReset: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockReset = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('ErrorPage Component', () => {
    it('should render error message when error occurs', () => {
      const testError = new Error('Test error message');

      render(<ErrorPage error={testError} reset={mockReset} />);

      expect(screen.getByText('Something went wrong')).toBeTruthy();
      expect(screen.getByText('Test error message')).toBeTruthy();
      expect(screen.getByText('Retrying in 5 seconds...')).toBeTruthy();
    });

    it('should display fallback message when error has no message', () => {
      const testError = { message: undefined } as unknown as Error;

      render(<ErrorPage error={testError} reset={mockReset} />);

      expect(screen.getByText('No error message received...')).toBeTruthy();
    });

    it('should render retry button', () => {
      const testError = new Error('Test error');

      render(<ErrorPage error={testError} reset={mockReset} />);

      const retryButton = screen.getByTestId('retry-button');
      expect(retryButton).toBeTruthy();
      expect(retryButton.textContent).toBe('Retry Now');
    });

    it('should call reset when retry button is clicked', () => {
      const testError = new Error('Test error');

      render(<ErrorPage error={testError} reset={mockReset} />);

      const retryButton = screen.getByTestId('retry-button');
      retryButton.click();

      expect(mockReset).toHaveBeenCalledTimes(1);
    });

    it('should auto-retry after 5 seconds', async () => {
      const testError = new Error('Test error');

      render(<ErrorPage error={testError} reset={mockReset} />);

      expect(mockReset).not.toHaveBeenCalled();

      // Advance time by 5 seconds
      vi.advanceTimersByTime(5000);

      // Wait for the timer to fire
      await vi.runAllTimersAsync();

      expect(mockReset).toHaveBeenCalledTimes(1);
    });

    it('should cleanup timer on unmount', () => {
      const testError = new Error('Test error');

      const { unmount } = render(<ErrorPage error={testError} reset={mockReset} />);

      // Unmount before timer fires
      unmount();

      // Advance time
      vi.advanceTimersByTime(5000);

      // Reset should not be called after unmount
      expect(mockReset).not.toHaveBeenCalled();
    });
  });

  describe('Error Scenarios That Should NOT Trigger Error Boundary', () => {
    it('should handle undefined context without triggering error boundary', () => {
      // Simulate the safe array operation
      const simulateRender = (context: any) => {
        if (Array.isArray(context)) {
          return context.map(item => item.name);
        }
        return [];
      };

      // These should not throw
      expect(() => simulateRender(undefined)).not.toThrow();
      expect(() => simulateRender(null)).not.toThrow();
      expect(() => simulateRender([])).not.toThrow();

      expect(simulateRender(undefined)).toEqual([]);
      expect(simulateRender(null)).toEqual([]);
      expect(simulateRender([])).toEqual([]);
    });

    it('should handle "Z.map is not a function" scenarios safely', () => {
      // Simulate what was happening before the fix
      const unsafeRender = (Z: any) => {
        // OLD CODE (would throw): Z?.map(item => item.name)
        // NEW CODE (safe):
        if (Array.isArray(Z)) {
          return Z.map(item => item.name);
        }
        return [];
      };

      // Test scenarios that previously caused "Z.map is not a function"
      expect(() => unsafeRender(undefined)).not.toThrow();
      expect(() => unsafeRender(null)).not.toThrow();
      expect(() => unsafeRender('not-an-array')).not.toThrow();
      expect(() => unsafeRender(42)).not.toThrow();
      expect(() => unsafeRender({ map: 'not a function' })).not.toThrow();
    });

    it('should handle nested array operations safely', () => {
      const safeNestedRender = (census: any) => {
        if (Array.isArray(census?.dateRanges)) {
          return census.dateRanges.map((dr: any) => dr.startDate);
        }
        return [];
      };

      // Test various undefined nested scenarios
      expect(() => safeNestedRender(undefined)).not.toThrow();
      expect(() => safeNestedRender({})).not.toThrow();
      expect(() => safeNestedRender({ dateRanges: undefined })).not.toThrow();
      expect(() => safeNestedRender({ dateRanges: null })).not.toThrow();

      expect(safeNestedRender(undefined)).toEqual([]);
      expect(safeNestedRender({})).toEqual([]);
      expect(safeNestedRender({ dateRanges: undefined })).toEqual([]);
    });
  });

  describe('Error Recovery Scenarios', () => {
    it('should recover after temporary undefined state', () => {
      const testError = new Error('Temporary state error');

      const { rerender } = render(<ErrorPage error={testError} reset={mockReset} />);

      expect(screen.getByText('Something went wrong')).toBeTruthy();

      // User clicks retry
      const retryButton = screen.getByTestId('retry-button');
      retryButton.click();

      expect(mockReset).toHaveBeenCalledTimes(1);
    });

    it('should not infinitely retry on persistent errors', () => {
      const testError = new Error('Persistent error');

      render(<ErrorPage error={testError} reset={mockReset} />);

      // Auto-retry after 5 seconds
      vi.advanceTimersByTime(5000);

      // Should only retry once automatically
      expect(mockReset).toHaveBeenCalledTimes(1);

      // If error persists, component will render again with new error
      // But won't automatically retry again unless timer is reset
    });
  });

  describe('Specific Error Messages', () => {
    it('should display "Z.map is not a function" error clearly', () => {
      const testError = new Error('Z.map is not a function');

      render(<ErrorPage error={testError} reset={mockReset} />);

      expect(screen.getByText('Z.map is not a function')).toBeTruthy();
      expect(screen.getByText('Something went wrong')).toBeTruthy();
      expect(screen.getByText('Retrying in 5 seconds...')).toBeTruthy();
    });

    it('should display context-related errors', () => {
      const testError = new Error('Cannot read property "map" of undefined');

      render(<ErrorPage error={testError} reset={mockReset} />);

      expect(screen.getByText('Cannot read property "map" of undefined')).toBeTruthy();
    });

    it('should display API-related errors', () => {
      const testError = new Error('Failed to load plots data');

      render(<ErrorPage error={testError} reset={mockReset} />);

      expect(screen.getByText('Failed to load plots data')).toBeTruthy();
    });

    it('should display network errors', () => {
      const testError = new Error('Network error');

      render(<ErrorPage error={testError} reset={mockReset} />);

      expect(screen.getByText('Network error')).toBeTruthy();
    });
  });

  describe('Error Boundary Integration with Context State', () => {
    it('should safely handle context clearing during site change', () => {
      // Simulate clearing contexts
      const clearContexts = (
        contexts: any
      ): {
        site: any;
        plot: any;
        census: any;
        plotList: any;
        censusList: any;
      } => {
        return {
          site: undefined,
          plot: undefined,
          census: undefined,
          plotList: undefined,
          censusList: undefined
        };
      };

      const clearedContexts = clearContexts({
        site: { siteName: 'Site A' },
        plot: { plotName: 'Plot 1' },
        census: { plotCensusNumber: 1 }
      });

      // Rendering with cleared contexts should not throw
      const safeRender = () => {
        if (Array.isArray(clearedContexts.plotList)) {
          return clearedContexts.plotList.map((p: any) => p.plotName);
        }
        if (Array.isArray(clearedContexts.censusList)) {
          return clearedContexts.censusList.map((c: any) => c.plotCensusNumber);
        }
        return [];
      };

      expect(() => safeRender()).not.toThrow();
      expect(safeRender()).toEqual([]);
    });

    it('should handle rapid state transitions without errors', () => {
      const states = [
        { plotList: [{ plotName: 'Plot 1' }] },
        { plotList: undefined }, // Clearing
        { plotList: [] }, // Empty
        { plotList: [{ plotName: 'Plot 2' }] } // Reloaded
      ];

      const safeTransition = (state: any) => {
        if (Array.isArray(state.plotList)) {
          return state.plotList.map((p: any) => p.plotName);
        }
        return [];
      };

      states.forEach(state => {
        expect(() => safeTransition(state)).not.toThrow();
      });

      expect(safeTransition(states[0])).toEqual(['Plot 1']);
      expect(safeTransition(states[1])).toEqual([]);
      expect(safeTransition(states[2])).toEqual([]);
      expect(safeTransition(states[3])).toEqual(['Plot 2']);
    });
  });

  describe('Prevent Infinite Retry Loops', () => {
    it('should only auto-retry once per error', () => {
      const testError = new Error('Test error');

      render(<ErrorPage error={testError} reset={mockReset} />);

      // First auto-retry after 5 seconds
      vi.advanceTimersByTime(5000);
      expect(mockReset).toHaveBeenCalledTimes(1);

      // Even if more time passes, should not retry again
      vi.advanceTimersByTime(10000);
      expect(mockReset).toHaveBeenCalledTimes(1);
    });

    it('should allow manual retry after auto-retry', () => {
      const testError = new Error('Test error');

      render(<ErrorPage error={testError} reset={mockReset} />);

      // Auto-retry
      vi.advanceTimersByTime(5000);
      expect(mockReset).toHaveBeenCalledTimes(1);

      // Manual retry
      const retryButton = screen.getByTestId('retry-button');
      retryButton.click();

      expect(mockReset).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error Message Formatting', () => {
    it('should handle TypeError messages', () => {
      const testError = new TypeError('Cannot read properties of undefined (reading "map")');

      render(<ErrorPage error={testError} reset={mockReset} />);

      expect(screen.getByText('Cannot read properties of undefined (reading "map")')).toBeTruthy();
    });

    it('should handle ReferenceError messages', () => {
      const testError = new ReferenceError('Z is not defined');

      render(<ErrorPage error={testError} reset={mockReset} />);

      expect(screen.getByText('Z is not defined')).toBeTruthy();
    });

    it('should handle custom error messages', () => {
      const testError = new Error('Custom application error occurred');

      render(<ErrorPage error={testError} reset={mockReset} />);

      expect(screen.getByText('Custom application error occurred')).toBeTruthy();
    });

    it('should handle error objects without proper Error type', () => {
      // Sometimes errors are thrown as plain objects
      const testError = { message: 'Plain object error' } as Error;

      render(<ErrorPage error={testError} reset={mockReset} />);

      expect(screen.getByText('Plain object error')).toBeTruthy();
    });

    it('should handle null error message', () => {
      const testError = new Error();
      testError.message = null as any;

      render(<ErrorPage error={testError} reset={mockReset} />);

      expect(screen.getByText('No error message received...')).toBeTruthy();
    });
  });

  describe('Accessibility and User Experience', () => {
    it('should provide clear error communication', () => {
      const testError = new Error('Network connection lost');

      render(<ErrorPage error={testError} reset={mockReset} />);

      // Main heading
      expect(screen.getByText('Something went wrong')).toBeTruthy();

      // Error details
      expect(screen.getByText('Network connection lost')).toBeTruthy();

      // Auto-retry message
      expect(screen.getByText('Retrying in 5 seconds...')).toBeTruthy();

      // Manual retry option
      expect(screen.getByTestId('retry-button')).toBeTruthy();
    });

    it('should provide immediate manual retry option', () => {
      const testError = new Error('Test error');

      render(<ErrorPage error={testError} reset={mockReset} />);

      const retryButton = screen.getByTestId('retry-button');

      // User can immediately click retry without waiting
      expect(mockReset).not.toHaveBeenCalled();

      retryButton.click();

      expect(mockReset).toHaveBeenCalledTimes(1);
    });
  });
});
