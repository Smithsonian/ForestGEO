import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FailedMeasurementsModal from './failedmeasurementsmodal';

const { sessionState, failedMeasurementsGridMock } = vi.hoisted(() => ({
  sessionState: { userStatus: 'global' },
  failedMeasurementsGridMock: vi.fn()
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { userStatus: sessionState.userStatus } } })
}));

// Mock dependencies - must match actual import path in component
vi.mock('@/app/contexts/compat-hooks', () => ({
  usePlotContext: () => ({ plotID: 1, plotName: 'Test Plot' }),
  useOrgCensusContext: () => ({ dateRanges: [{ censusID: 1, startDate: '2024-01-01', endDate: '2024-12-31' }], plotCensusNumber: 1 }),
  useSiteContext: () => ({ schemaName: 'testschema', siteName: 'Test Site' })
}));

vi.mock('@/components/datagrids/applications/isolated/isolatedfailedmeasurementsdatagrid', () => ({
  default: (props: Record<string, unknown>) => {
    failedMeasurementsGridMock(props);
    return <div data-testid="failed-measurements-grid">Mock Grid</div>;
  }
}));

vi.mock('@/ailogger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

describe('FailedMeasurementsModal', () => {
  const mockHandleCloseModal = vi.fn();

  const defaultProps = {
    open: true,
    handleCloseModal: mockHandleCloseModal
  };

  beforeEach(() => {
    vi.clearAllMocks();
    sessionState.userStatus = 'global';
    global.fetch = vi.fn();
    mockHandleCloseModal.mockResolvedValue(undefined);
  });

  describe('Bug Fix: Modal close should NOT trigger view reset', () => {
    it('should call handleCloseModal without reingestion when Close button is clicked', async () => {
      const user = userEvent.setup();

      // Mock fetch to return non-zero counts to prevent auto-close
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ recordCount: 5 })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ recordCount: 0 })
        });

      render(<FailedMeasurementsModal {...defaultProps} />);

      // Wait for counts to load (prevents auto-close race condition)
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Clear Failed/i })).toHaveTextContent('5');
      });

      // Use exact text match for the Close button (not the ModalClose X icon button)
      const closeButton = screen.getByRole('button', { name: 'Close' });
      await user.click(closeButton);

      await waitFor(() => {
        expect(mockHandleCloseModal).toHaveBeenCalledTimes(1);
      });

      expect(mockHandleCloseModal).toHaveBeenCalledWith({ dataChanged: false });
    });

    it('should set reingested flag when Clear Failed is executed', async () => {
      const user = userEvent.setup();

      // Mock successful fetch for record counts
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ recordCount: 5 })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ recordCount: 0 })
        })
        // Mock re-fetch after clicking Clear Failed button
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ recordCount: 5 })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ recordCount: 0 })
        })
        // Mock successful delete
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ recordsCleared: 5 })
        })
        // Mock re-fetch after delete
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ recordCount: 0 })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ recordCount: 0 })
        });

      render(<FailedMeasurementsModal {...defaultProps} />);

      // Wait for initial counts to load
      await waitFor(
        () => {
          const button = screen.getByRole('button', { name: /Clear Failed/i });
          expect(button).toHaveTextContent('5');
        },
        { timeout: 3000 }
      );

      const clearFailedButton = screen.getByRole('button', { name: /Clear Failed/i });
      await user.click(clearFailedButton);

      // Wait for confirmation dialog
      await waitFor(() => {
        expect(screen.getByText(/Confirm Clear Failed Measurements/i)).toBeInTheDocument();
      });

      // Confirm deletion
      const confirmButton = screen.getByRole('button', { name: /Confirm Delete/i });
      await user.click(confirmButton);

      await waitFor(
        () => {
          expect(mockHandleCloseModal).toHaveBeenCalledWith({ dataChanged: true });
        },
        { timeout: 3000 }
      );
    });

    it('should set reingested flag when Reingest All Rows is executed', async () => {
      const user = userEvent.setup();

      // Provide a fallback response in case an additional count refresh occurs.
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ recordCount: 0 })
      });

      // Mock successful reingest
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ recordCount: 5 })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ recordCount: 2 })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ rowsMoved: 5, fileID: 'test.csv', batchID: 'batch-123' })
        });

      render(<FailedMeasurementsModal {...defaultProps} />);

      // Wait for record counts to load first (failedCount = 5)
      await waitFor(
        () => {
          expect(screen.getByRole('button', { name: /Clear Failed/i })).toHaveTextContent('5');
        },
        { timeout: 3000 }
      );

      // Now the reingest button should be enabled and clickable
      const reingestButton = screen.getByRole('button', { name: /Reingest All Rows/i });
      expect(reingestButton).not.toBeDisabled();
      await user.click(reingestButton);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/reingest/testschema/1/1'), { method: 'GET' });
      });

      // Wait for the reingestion process to complete
      await waitFor(
        () => {
          expect(mockHandleCloseModal).toHaveBeenCalledWith({ dataChanged: true });
        },
        { timeout: 15000 } // Increased timeout for async operations
      );

      expect(mockHandleCloseModal).toHaveBeenCalled();
    });
  });

  describe('Modal behavior', () => {
    it('should render when open is true', () => {
      render(<FailedMeasurementsModal {...defaultProps} />);
      expect(screen.getByText('Failed Measurements')).toBeInTheDocument();
      expect(screen.getByTestId('failed-measurements-grid')).toBeInTheDocument();
    });

    it('should not render when open is false', () => {
      render(<FailedMeasurementsModal {...defaultProps} open={false} />);
      expect(screen.queryByText('Failed Measurements')).not.toBeInTheDocument();
    });

    it('should fetch record counts on mount', async () => {
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ recordCount: 10 })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ recordCount: 5 })
        });

      render(<FailedMeasurementsModal {...defaultProps} />);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/failedmeasurements/count/testschema/1/1'),
          expect.objectContaining({ method: 'GET' })
        );
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/admin/clear/temporarymeasurements/testschema/1/1'),
          expect.objectContaining({ method: 'GET' })
        );
      });
    });

    it('does not auto-close on an empty initial load when autoCloseWhenEmpty is disabled', async () => {
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ recordCount: 0 })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ recordCount: 0 })
        });

      render(<FailedMeasurementsModal {...defaultProps} autoCloseWhenEmpty={false} />);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(2);
      });

      expect(mockHandleCloseModal).not.toHaveBeenCalled();
      expect(screen.getByText('Failed Measurements')).toBeInTheDocument();
    });

    it('hides admin-only clear controls from non-admin site users', async () => {
      sessionState.userStatus = 'field crew';
      (global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ recordCount: 2 }) });

      render(<FailedMeasurementsModal {...defaultProps} />);

      await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/failedmeasurements/count/testschema/1/1'),
        expect.objectContaining({ method: 'GET' })
      );
      expect(screen.queryByRole('button', { name: /Clear Failed/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Clear Temp/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Reingest All Rows/i })).toBeInTheDocument();
    });

    it('keeps recovery controls and the editable grid hidden for pending users', () => {
      sessionState.userStatus = 'pending';

      render(<FailedMeasurementsModal {...defaultProps} />);

      expect(screen.getByText(/read-only access/i)).toBeInTheDocument();
      expect(screen.queryByTestId('failed-measurements-grid')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Reingest All Rows/i })).not.toBeInTheDocument();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('reports row-level reingestion to the parent when the user closes a deep-linked modal', async () => {
      const user = userEvent.setup();
      (global.fetch as any)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ recordCount: 1 }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ recordCount: 0 }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ recordCount: 0 }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ recordCount: 0 }) });

      render(<FailedMeasurementsModal {...defaultProps} autoCloseWhenEmpty={false} />);
      await waitFor(() => expect(screen.getByRole('button', { name: /Clear Failed/i })).toHaveTextContent('1'));

      const gridProps = failedMeasurementsGridMock.mock.calls.at(-1)?.[0] as { onRowReingested: () => void };
      gridProps.onRowReingested();
      await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(4));
      await user.click(screen.getByRole('button', { name: 'Close' }));

      expect(mockHandleCloseModal).toHaveBeenCalledWith({ dataChanged: true });
    });
  });
});
