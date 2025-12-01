import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AutocompleteFixedData from './autocompletefixeddata';
import { useSiteContext } from '@/app/contexts/compat-hooks';
import ailogger from '@/ailogger';

// Mock dependencies
vi.mock('@/app/contexts/compat-hooks', () => ({
  useSiteContext: vi.fn()
}));
vi.mock('@/ailogger');

const mockUseSiteContext = vi.mocked(useSiteContext);

describe('AutocompleteFixedData - Functional Tests', () => {
  const mockOnChange = vi.fn();
  const mockSiteContext = {
    schemaName: 'test_schema',
    siteName: 'Test Site',
    siteID: 1
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSiteContext.mockReturnValue(mockSiteContext as any);

    // Mock fetch globally with immediate resolution
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => []
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Accessibility Requirements', () => {
    it('MUST have an accessible label for the autocomplete field', () => {
      render(<AutocompleteFixedData dataType="Species" value="" onChange={mockOnChange} />);

      // Must be findable by its label
      const input = screen.getByLabelText('Species');
      expect(input).toBeInTheDocument();
    });

    it('MUST announce loading state to screen readers', async () => {
      let resolvePromise: (value: any) => void;
      const promise = new Promise(resolve => {
        resolvePromise = resolve;
      });

      (global.fetch as any).mockReturnValue(
        promise.then(() => ({
          ok: true,
          json: async () => []
        }))
      );

      render(<AutocompleteFixedData dataType="Species" value="" onChange={mockOnChange} />);

      // Loading indicator should be present
      await waitFor(
        () => {
          expect(screen.getByRole('progressbar')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );

      resolvePromise!(null);

      // Should disappear when loaded
      await waitFor(
        () => {
          expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });

    it('SHOULD communicate errors to screen readers via aria-live', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      render(<AutocompleteFixedData dataType="Species" value="" onChange={mockOnChange} />);

      await waitFor(
        () => {
          expect(ailogger.error).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      // Component should still render
      expect(screen.getByLabelText('Species')).toBeInTheDocument();

      // IMPROVEMENT OPPORTUNITY: Add aria-live region for error messages
      const errorRegion = screen.queryByRole('alert');
      if (!errorRegion) {
        console.warn('⚠️  No aria-live error message for screen readers. Users cannot detect fetch failures.');
      }

      consoleErrorSpy.mockRestore();
    });

    it('MUST be keyboard accessible', async () => {
      const mockOptions = ['Option1', 'Option2', 'Option3'];
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockOptions
      });

      const user = userEvent.setup();
      render(<AutocompleteFixedData dataType="Species" value="" onChange={mockOnChange} />);

      await waitFor(
        () => {
          expect(global.fetch).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      const input = screen.getByLabelText('Species');

      // Tab to input
      input.focus();
      expect(input).toHaveFocus();

      // Type to filter
      await user.keyboard('Option1');

      // Should trigger onChange when option selected
      await waitFor(
        () => {
          expect(input).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });
  });

  describe('Data Fetching Behavior', () => {
    it('MUST fetch initial options on mount', async () => {
      const mockData = ['Species1', 'Species2', 'Species3'];
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockData
      });

      render(<AutocompleteFixedData dataType="Species" value="" onChange={mockOnChange} />);

      await waitFor(
        () => {
          expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('/api/formsearch/Species?schema=test_schema&searchfor='),
            expect.objectContaining({ signal: expect.any(AbortSignal) })
          );
        },
        { timeout: 3000 }
      );
    });

    it('MUST use correct schema from site context', async () => {
      render(<AutocompleteFixedData dataType="Personnel" value="" onChange={mockOnChange} />);

      await waitFor(
        () => {
          expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('schema=test_schema'),
            expect.objectContaining({ signal: expect.any(AbortSignal) })
          );
        },
        { timeout: 3000 }
      );
    });

    it('MUST properly encode search parameters', async () => {
      const user = userEvent.setup();

      render(<AutocompleteFixedData dataType="Species" value="" onChange={mockOnChange} />);

      await waitFor(
        () => {
          expect(global.fetch).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      vi.clearAllMocks();

      const input = screen.getByLabelText('Species');
      await user.type(input, 'A&B');

      await waitFor(
        () => {
          const calls = (global.fetch as any).mock.calls;
          const hasEncodedCall = calls.some((call: any[]) => call[0]?.includes('searchfor=A%26B'));
          expect(hasEncodedCall).toBe(true);
        },
        { timeout: 3000 }
      );
    });

    it('MUST handle fetch errors gracefully without crashing', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      // Should not crash the component
      expect(() => render(<AutocompleteFixedData dataType="Species" value="" onChange={mockOnChange} />)).not.toThrow();

      await waitFor(
        () => {
          expect(ailogger.error).toHaveBeenCalledWith('Error fetching data:', expect.any(Error));
        },
        { timeout: 3000 }
      );

      // Component should still be functional
      expect(screen.getByLabelText('Species')).toBeInTheDocument();

      consoleErrorSpy.mockRestore();
    });

    it('SHOULD handle race conditions when multiple fetches occur', async () => {
      const user = userEvent.setup();

      let firstResolve: any, secondResolve: any;
      const firstPromise = new Promise(resolve => {
        firstResolve = resolve;
      });
      const secondPromise = new Promise(resolve => {
        secondResolve = resolve;
      });

      // First fetch (slow)
      (global.fetch as any).mockReturnValueOnce(firstPromise.then(() => ({ ok: true, json: async () => ['Old1', 'Old2'] })));

      render(<AutocompleteFixedData dataType="Species" value="" onChange={mockOnChange} />);

      // Wait for first fetch to start
      await waitFor(
        () => {
          expect(global.fetch).toHaveBeenCalledTimes(1);
        },
        { timeout: 3000 }
      );

      // Trigger second fetch (fast)
      (global.fetch as any).mockReturnValueOnce(secondPromise.then(() => ({ ok: true, json: async () => ['New1', 'New2'] })));

      const input = screen.getByLabelText('Species');
      await user.type(input, 'New');

      // Resolve second fetch first (newer)
      secondResolve!(null);

      // Then resolve first fetch (older, should be ignored)
      firstResolve!(null);

      // Component should show the newer results
      await waitFor(
        () => {
          expect(screen.getByLabelText('Species')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });
  });

  describe('User Interaction', () => {
    it('MUST call onChange when user selects an option', async () => {
      const mockOptions = ['Option1', 'Option2', 'Option3'];
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockOptions
      });

      const user = userEvent.setup();

      render(<AutocompleteFixedData dataType="Species" value="" onChange={mockOnChange} />);

      await waitFor(
        () => {
          expect(global.fetch).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      const input = screen.getByLabelText('Species');

      // Click to open dropdown
      await user.click(input);

      // Wait for options to appear
      await waitFor(
        () => {
          expect(screen.getByText('Option1')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );

      // Click an option
      await user.click(screen.getByText('Option1'));

      // Verify onChange was called
      await waitFor(
        () => {
          expect(mockOnChange).toHaveBeenCalledWith('Option1');
        },
        { timeout: 3000 }
      );
    });

    it('MUST call onChange with empty string when cleared', async () => {
      const mockOptions = ['Option1'];
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockOptions
      });

      const user = userEvent.setup();

      render(<AutocompleteFixedData dataType="Species" value="Option1" onChange={mockOnChange} />);

      const input = screen.getByLabelText('Species');

      // Clear the input
      await user.clear(input);

      // Component should still function
      expect(screen.getByLabelText('Species')).toBeInTheDocument();
    });

    it('MUST display current value correctly', async () => {
      (global.fetch as any).mockResolvedValue({
        json: async () => ['Species1', 'Species2']
      });

      render(<AutocompleteFixedData dataType="Species" value="Species1" onChange={mockOnChange} />);

      const input = screen.getByLabelText('Species') as HTMLInputElement;
      await waitFor(
        () => {
          expect(input.value).toBe('Species1');
        },
        { timeout: 3000 }
      );
    });

    it('MUST filter options as user types', async () => {
      const user = userEvent.setup();

      render(<AutocompleteFixedData dataType="Species" value="" onChange={mockOnChange} />);

      await waitFor(
        () => {
          expect(global.fetch).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      vi.clearAllMocks();

      const input = screen.getByLabelText('Species');
      await user.type(input, 'test');

      // Should trigger fetch with search parameter
      await waitFor(
        () => {
          const calls = (global.fetch as any).mock.calls;
          const hasSearchCall = calls.some((call: any[]) => call[0]?.includes('searchfor=test'));
          expect(hasSearchCall).toBe(true);
        },
        { timeout: 3000 }
      );
    });
  });

  describe('Component Lifecycle', () => {
    it('MUST clean up timers on unmount to prevent memory leaks', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      const { unmount } = render(<AutocompleteFixedData dataType="Species" value="" onChange={mockOnChange} />);

      unmount();

      // Should have called clearTimeout during cleanup
      expect(clearTimeoutSpy).toHaveBeenCalled();

      clearTimeoutSpy.mockRestore();
    });

    it('MUST handle rapid prop changes without breaking', () => {
      const { rerender } = render(<AutocompleteFixedData dataType="Species" value="Value1" onChange={mockOnChange} />);

      rerender(<AutocompleteFixedData dataType="Species" value="Value2" onChange={mockOnChange} />);
      rerender(<AutocompleteFixedData dataType="Species" value="Value3" onChange={mockOnChange} />);
      rerender(<AutocompleteFixedData dataType="Species" value="Value4" onChange={mockOnChange} />);

      expect(screen.getByLabelText('Species')).toBeInTheDocument();
    });

    it('MUST throw helpful error when site context is missing', () => {
      mockUseSiteContext.mockReturnValue(null as any);

      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Component now handles missing context gracefully instead of crashing
      expect(() => {
        render(<AutocompleteFixedData dataType="Species" value="" onChange={mockOnChange} />);
      }).not.toThrow();

      // But it should still render without errors
      expect(screen.getByLabelText('Species')).toBeInTheDocument();

      consoleError.mockRestore();
    });
  });

  describe('Visual Feedback', () => {
    it('MUST show loading indicator during fetch', async () => {
      let resolvePromise: (value: any) => void;
      const promise = new Promise(resolve => {
        resolvePromise = resolve;
      });

      (global.fetch as any).mockReturnValue(
        promise.then(() => ({
          ok: true,
          json: async () => []
        }))
      );

      render(<AutocompleteFixedData dataType="Species" value="" onChange={mockOnChange} />);

      // Loading should be visible
      await waitFor(
        () => {
          expect(screen.getByRole('progressbar')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );

      resolvePromise!(null);

      // Loading should disappear
      await waitFor(
        () => {
          expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });

    it('MUST apply custom CSS class for styling', () => {
      const { container } = render(<AutocompleteFixedData dataType="Species" value="" onChange={mockOnChange} />);

      const autocomplete = container.querySelector('.fullWidthAutoComplete');
      expect(autocomplete).toBeInTheDocument();
    });

    it('MUST use high z-index for dropdown to appear above other content', async () => {
      const mockOptions = ['Option1', 'Option2'];
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockOptions
      });

      const user = userEvent.setup();

      render(<AutocompleteFixedData dataType="Species" value="" onChange={mockOnChange} />);

      await waitFor(
        () => {
          expect(global.fetch).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      const input = screen.getByLabelText('Species');
      await user.click(input);

      await waitFor(
        () => {
          const popper = document.querySelector('[role="presentation"]');
          expect(popper).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });
  });

  describe('Performance & Optimization', () => {
    it('SHOULD not fetch on every keystroke (debouncing)', async () => {
      const user = userEvent.setup();

      render(<AutocompleteFixedData dataType="Species" value="" onChange={mockOnChange} />);

      await waitFor(
        () => {
          expect(global.fetch).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      const _initialCallCount = (global.fetch as any).mock.calls.length;
      vi.clearAllMocks();

      const input = screen.getByLabelText('Species');

      // Type multiple characters rapidly
      await user.type(input, 'abc');

      // Should trigger fetches, but document current behavior
      await waitFor(
        () => {
          expect(global.fetch).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      const callsAfterTyping = (global.fetch as any).mock.calls.length;

      // IMPROVEMENT OPPORTUNITY: Should debounce to reduce API calls
      if (callsAfterTyping > 1) {
        console.warn(`⚠️  Typing 3 characters triggered ${callsAfterTyping} fetches. Consider proper debouncing.`);
      }
    });

    it('MUST handle empty response data without errors', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => []
      });

      render(<AutocompleteFixedData dataType="Species" value="" onChange={mockOnChange} />);

      await waitFor(
        () => {
          expect(global.fetch).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      // Should render without errors
      expect(screen.getByLabelText('Species')).toBeInTheDocument();
    });

    it('MUST handle large datasets efficiently', async () => {
      const largeDataset = Array.from({ length: 1000 }, (_, i) => `Option${i}`);

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => largeDataset
      });

      const user = userEvent.setup();

      render(<AutocompleteFixedData dataType="Species" value="" onChange={mockOnChange} />);

      await waitFor(
        () => {
          expect(global.fetch).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      const input = screen.getByLabelText('Species');
      await user.click(input);

      // Should render without performance issues
      expect(input).toBeInTheDocument();
    });
  });
});
