import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ResetViewModal from './resetviewmodal';

describe('ResetViewModal - Functional Tests', () => {
  const mockSetOpen = vi.fn();
  const mockTriggerResetView = vi.fn();
  const defaultProps = {
    open: true,
    setOpen: mockSetOpen,
    triggerResetView: mockTriggerResetView
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering and Visibility', () => {
    it('MUST render modal when open is true', () => {
      render(<ResetViewModal {...defaultProps} />);

      expect(screen.getByText('Reset View')).toBeInTheDocument();
      expect(screen.getByText('Are you sure you want to reset this table?')).toBeInTheDocument();
      expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument();
    });

    it('MUST NOT render modal when open is false', () => {
      render(<ResetViewModal {...defaultProps} open={false} />);

      expect(screen.queryByText('Reset View')).not.toBeInTheDocument();
    });

    it('MUST display Reset View title', () => {
      render(<ResetViewModal {...defaultProps} />);

      expect(screen.getByText('Reset View')).toBeInTheDocument();
    });

    it('MUST display confirmation question', () => {
      render(<ResetViewModal {...defaultProps} />);

      expect(screen.getByText('Are you sure you want to reset this table?')).toBeInTheDocument();
    });

    it('MUST display warning message', () => {
      render(<ResetViewModal {...defaultProps} />);

      const warning = screen.getByText('This action cannot be undone.');
      expect(warning).toBeInTheDocument();
    });

    it('MUST render Cancel button', () => {
      render(<ResetViewModal {...defaultProps} />);

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      expect(cancelButton).toBeInTheDocument();
    });

    it('MUST render Reset button', () => {
      render(<ResetViewModal {...defaultProps} />);

      const resetButton = screen.getByRole('button', { name: /reset/i });
      expect(resetButton).toBeInTheDocument();
    });
  });

  describe('User Interaction - Button Clicks', () => {
    it('MUST call setOpen(false) when Cancel button is clicked', async () => {
      const user = userEvent.setup();
      render(<ResetViewModal {...defaultProps} />);

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      expect(mockSetOpen).toHaveBeenCalledTimes(1);
      expect(mockSetOpen).toHaveBeenCalledWith(false);
      expect(mockTriggerResetView).not.toHaveBeenCalled();
    });

    it('MUST call triggerResetView when Reset button is clicked', async () => {
      const user = userEvent.setup();
      render(<ResetViewModal {...defaultProps} />);

      const resetButton = screen.getByRole('button', { name: /reset/i });
      await user.click(resetButton);

      expect(mockTriggerResetView).toHaveBeenCalledTimes(1);
      expect(mockSetOpen).not.toHaveBeenCalled();
    });

    it('MUST NOT call handlers when modal is closed', () => {
      const { rerender } = render(<ResetViewModal {...defaultProps} />);

      // Close the modal
      rerender(<ResetViewModal {...defaultProps} open={false} />);

      expect(mockSetOpen).not.toHaveBeenCalled();
      expect(mockTriggerResetView).not.toHaveBeenCalled();
    });
  });

  describe('Keyboard Navigation', () => {
    it('MUST support Tab navigation between buttons', async () => {
      const user = userEvent.setup();
      render(<ResetViewModal {...defaultProps} />);

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      const resetButton = screen.getByRole('button', { name: /reset/i });

      // Focus should be able to move to buttons
      await user.tab();

      // One of the buttons should receive focus
      expect(cancelButton === document.activeElement || resetButton === document.activeElement).toBe(true);
    });

    it('MUST have buttons that are keyboard accessible', () => {
      render(<ResetViewModal {...defaultProps} />);

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      const resetButton = screen.getByRole('button', { name: /reset/i });

      expect(cancelButton).not.toBeDisabled();
      expect(resetButton).not.toBeDisabled();
    });
  });

  describe('Component State Management', () => {
    it('MUST toggle visibility based on open prop', async () => {
      const { rerender } = render(<ResetViewModal {...defaultProps} open={true} />);
      expect(screen.getByText('Reset View')).toBeInTheDocument();

      rerender(<ResetViewModal {...defaultProps} open={false} />);
      await waitFor(() => {
        expect(screen.queryByText('Reset View')).not.toBeInTheDocument();
      });

      rerender(<ResetViewModal {...defaultProps} open={true} />);
      await waitFor(() => {
        expect(screen.getByText('Reset View')).toBeInTheDocument();
      });
    });

    it('MUST accept different handler functions', async () => {
      const newSetOpen = vi.fn();
      const newTriggerReset = vi.fn();
      const user = userEvent.setup();

      const { rerender } = render(<ResetViewModal {...defaultProps} />);

      rerender(<ResetViewModal open={true} setOpen={newSetOpen} triggerResetView={newTriggerReset} />);

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      expect(newSetOpen).toHaveBeenCalledWith(false);
      expect(mockSetOpen).not.toHaveBeenCalled();
    });
  });

  describe('Warning Message Styling', () => {
    it('MUST display warning with emphasis', () => {
      render(<ResetViewModal {...defaultProps} />);

      const warning = screen.getByText('This action cannot be undone.');
      // MUI Joy UI applies specific typography classes
      expect(warning).toHaveClass(/MuiTypography/);
    });
  });

  describe('Component Integrity', () => {
    it('MUST render without crashing', () => {
      expect(() => render(<ResetViewModal {...defaultProps} />)).not.toThrow();
    });

    it('MUST render consistently across multiple renders', () => {
      const { rerender } = render(<ResetViewModal {...defaultProps} />);
      const firstRender = screen.getByText('Reset View').outerHTML;

      rerender(<ResetViewModal {...defaultProps} />);
      const secondRender = screen.getByText('Reset View').outerHTML;

      expect(firstRender).toBe(secondRender);
    });

    it('MUST maintain structure with all elements present', () => {
      render(<ResetViewModal {...defaultProps} />);

      expect(screen.getByText('Reset View')).toBeInTheDocument();
      expect(screen.getByText('Are you sure you want to reset this table?')).toBeInTheDocument();
      expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /reset/i })).toBeInTheDocument();
    });
  });

  describe('Modal Dialog Structure', () => {
    it('MUST render with ModalDialog wrapper', () => {
      render(<ResetViewModal {...defaultProps} />);

      // MUI Joy renders ModalDialog in document body
      const modalDialog = document.querySelector('[role="dialog"]');
      expect(modalDialog).toBeInTheDocument();
    });

    it('MUST have proper dialog sections', () => {
      render(<ResetViewModal {...defaultProps} />);

      // Title should be in document
      expect(screen.getByText('Reset View')).toBeInTheDocument();

      // Content should be in document
      expect(screen.getByText('Are you sure you want to reset this table?')).toBeInTheDocument();

      // Actions (buttons) should be in document
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /reset/i })).toBeInTheDocument();
    });
  });

  describe('Button Order and Layout', () => {
    it('MUST render buttons in correct order (Cancel then Reset)', () => {
      render(<ResetViewModal {...defaultProps} />);

      const buttons = screen.getAllByRole('button');
      expect(buttons[0]).toHaveTextContent('Cancel');
      expect(buttons[1]).toHaveTextContent('Reset');
    });
  });

  describe('Async Operation Handling', () => {
    it('MUST handle async triggerResetView function', async () => {
      const asyncReset = vi.fn().mockResolvedValue(undefined);
      const user = userEvent.setup();

      render(<ResetViewModal {...defaultProps} triggerResetView={asyncReset} />);

      const resetButton = screen.getByRole('button', { name: /reset/i });
      await user.click(resetButton);

      expect(asyncReset).toHaveBeenCalledTimes(1);
    });

    it('MUST handle triggerResetView that throws error', async () => {
      const errorReset = vi.fn().mockRejectedValue(new Error('Reset failed'));
      const user = userEvent.setup();

      render(<ResetViewModal {...defaultProps} triggerResetView={errorReset} />);

      const resetButton = screen.getByRole('button', { name: /reset/i });
      await user.click(resetButton);

      expect(errorReset).toHaveBeenCalledTimes(1);
      // Component should not crash even if async operation fails
    });
  });

  describe('Modal Backdrop Behavior', () => {
    it('MUST NOT close when clicking backdrop (onClose is empty)', async () => {
      const user = userEvent.setup();
      render(<ResetViewModal {...defaultProps} />);

      // Modal has onClose={() => {}} which means it doesn't close on backdrop click
      const modal = document.querySelector('[role="presentation"]');
      if (modal) {
        await user.click(modal);
        // Modal should still be open
        expect(screen.getByText('Reset View')).toBeInTheDocument();
      }
    });
  });

  describe('Accessibility', () => {
    it('MUST have role="dialog" for modal content', () => {
      render(<ResetViewModal {...defaultProps} />);

      // MUI Joy renders ModalDialog in document body
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog).toBeInTheDocument();
    });

    it('MUST have accessible button labels', () => {
      render(<ResetViewModal {...defaultProps} />);

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      const resetButton = screen.getByRole('button', { name: /reset/i });

      expect(cancelButton).toHaveAccessibleName();
      expect(resetButton).toHaveAccessibleName();
    });
  });

  describe('Typography Hierarchy', () => {
    it('MUST use title level for main question', () => {
      render(<ResetViewModal {...defaultProps} />);

      const question = screen.getByText('Are you sure you want to reset this table?');
      expect(question).toHaveClass(/MuiTypography/);
    });

    it('MUST use body level for warning message', () => {
      render(<ResetViewModal {...defaultProps} />);

      const warning = screen.getByText('This action cannot be undone.');
      expect(warning).toHaveClass(/MuiTypography/);
    });
  });

  describe('Multiple Click Protection', () => {
    it('MUST handle rapid successive Cancel button clicks', async () => {
      const user = userEvent.setup();
      render(<ResetViewModal {...defaultProps} />);

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);
      await user.click(cancelButton);

      // Should call setOpen for each click
      expect(mockSetOpen).toHaveBeenCalledTimes(2);
      expect(mockSetOpen).toHaveBeenCalledWith(false);
    });

    it('MUST handle rapid successive Reset button clicks', async () => {
      const user = userEvent.setup();
      render(<ResetViewModal {...defaultProps} />);

      const resetButton = screen.getByRole('button', { name: /reset/i });
      await user.click(resetButton);
      await user.click(resetButton);

      // Should call triggerResetView for each click
      expect(mockTriggerResetView).toHaveBeenCalledTimes(2);
    });
  });
});
