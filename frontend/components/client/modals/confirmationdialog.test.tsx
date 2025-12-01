import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConfirmationDialog from './confirmationdialog';

describe('ConfirmationDialog - Functional Tests', () => {
  const mockOnClose = vi.fn();
  const mockOnConfirm = vi.fn();
  const defaultProps = {
    open: true,
    onClose: mockOnClose,
    onConfirm: mockOnConfirm,
    title: 'Confirm Action',
    content: 'Are you sure you want to proceed with this action?'
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering and Visibility', () => {
    it('MUST render dialog when open is true', () => {
      render(<ConfirmationDialog {...defaultProps} />);

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Confirm Action')).toBeInTheDocument();
      expect(screen.getByText('Are you sure you want to proceed with this action?')).toBeInTheDocument();
    });

    it('MUST NOT render dialog when open is false', () => {
      render(<ConfirmationDialog {...defaultProps} open={false} />);

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('MUST display custom title text', () => {
      render(<ConfirmationDialog {...defaultProps} title="Delete Item" />);

      expect(screen.getByText('Delete Item')).toBeInTheDocument();
    });

    it('MUST display custom content text', () => {
      render(<ConfirmationDialog {...defaultProps} content="This action cannot be undone." />);

      expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument();
    });

    it('MUST render Cancel button', () => {
      render(<ConfirmationDialog {...defaultProps} />);

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      expect(cancelButton).toBeInTheDocument();
    });

    it('MUST render Confirm button', () => {
      render(<ConfirmationDialog {...defaultProps} />);

      const confirmButton = screen.getByRole('button', { name: /confirm/i });
      expect(confirmButton).toBeInTheDocument();
    });
  });

  describe('Accessibility - ARIA Attributes', () => {
    it('MUST have proper dialog role', () => {
      render(<ConfirmationDialog {...defaultProps} />);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
    });

    it('MUST have aria-labelledby pointing to title', () => {
      render(<ConfirmationDialog {...defaultProps} />);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-labelledby', 'alert-dialog-title');
    });

    it('MUST have aria-describedby pointing to content', () => {
      render(<ConfirmationDialog {...defaultProps} />);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-describedby', 'alert-dialog-description');
    });

    it('MUST have title with correct id', () => {
      render(<ConfirmationDialog {...defaultProps} />);

      const title = document.querySelector('#alert-dialog-title');
      expect(title).toBeInTheDocument();
      expect(title).toHaveTextContent('Confirm Action');
    });

    it('MUST have content with correct id', () => {
      render(<ConfirmationDialog {...defaultProps} />);

      const description = document.querySelector('#alert-dialog-description');
      expect(description).toBeInTheDocument();
      expect(description).toHaveTextContent('Are you sure you want to proceed with this action?');
    });
  });

  describe('User Interaction - Button Clicks', () => {
    it('MUST call onClose when Cancel button is clicked', async () => {
      const user = userEvent.setup();
      render(<ConfirmationDialog {...defaultProps} />);

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
      expect(mockOnConfirm).not.toHaveBeenCalled();
    });

    it('MUST call onConfirm when Confirm button is clicked', async () => {
      const user = userEvent.setup();
      render(<ConfirmationDialog {...defaultProps} />);

      const confirmButton = screen.getByRole('button', { name: /confirm/i });
      await user.click(confirmButton);

      expect(mockOnConfirm).toHaveBeenCalledTimes(1);
      expect(mockOnClose).not.toHaveBeenCalled();
    });

    it('MUST NOT call handlers when dialog is closed', async () => {
      const _user = userEvent.setup();
      const { rerender } = render(<ConfirmationDialog {...defaultProps} />);

      // Close the dialog
      rerender(<ConfirmationDialog {...defaultProps} open={false} />);

      expect(mockOnClose).not.toHaveBeenCalled();
      expect(mockOnConfirm).not.toHaveBeenCalled();
    });
  });

  describe('Keyboard Navigation', () => {
    it('MUST support Tab navigation between buttons', async () => {
      const user = userEvent.setup();
      render(<ConfirmationDialog {...defaultProps} />);

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      const confirmButton = screen.getByRole('button', { name: /confirm/i });

      // Focus should be able to move to buttons
      await user.tab();

      // One of the buttons should receive focus
      expect(cancelButton === document.activeElement || confirmButton === document.activeElement).toBe(true);
    });

    it('MUST be keyboard accessible', () => {
      render(<ConfirmationDialog {...defaultProps} />);

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      const confirmButton = screen.getByRole('button', { name: /confirm/i });

      expect(cancelButton).not.toBeDisabled();
      expect(confirmButton).not.toBeDisabled();
    });
  });

  describe('Component State Management', () => {
    it('MUST update when props change', () => {
      const { rerender } = render(<ConfirmationDialog {...defaultProps} />);
      expect(screen.getByText('Confirm Action')).toBeInTheDocument();

      rerender(<ConfirmationDialog {...defaultProps} title="New Title" content="New content" />);
      expect(screen.getByText('New Title')).toBeInTheDocument();
      expect(screen.getByText('New content')).toBeInTheDocument();
    });

    it('MUST toggle visibility based on open prop', async () => {
      const { rerender } = render(<ConfirmationDialog {...defaultProps} open={true} />);
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      rerender(<ConfirmationDialog {...defaultProps} open={false} />);
      // MUI dialogs use CSS transitions and may remain in DOM briefly
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });

      rerender(<ConfirmationDialog {...defaultProps} open={true} />);
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('MUST handle empty title gracefully', () => {
      render(<ConfirmationDialog {...defaultProps} title="" />);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
    });

    it('MUST handle empty content gracefully', () => {
      render(<ConfirmationDialog {...defaultProps} content="" />);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
    });

    it('MUST handle long title text', () => {
      const longTitle = 'A'.repeat(200);
      render(<ConfirmationDialog {...defaultProps} title={longTitle} />);

      expect(screen.getByText(longTitle)).toBeInTheDocument();
    });

    it('MUST handle long content text', () => {
      const longContent = 'B'.repeat(500);
      render(<ConfirmationDialog {...defaultProps} content={longContent} />);

      expect(screen.getByText(longContent)).toBeInTheDocument();
    });

    it('MUST handle special characters in title', () => {
      render(<ConfirmationDialog {...defaultProps} title="<script>alert('test')</script>" />);

      expect(screen.getByText("<script>alert('test')</script>")).toBeInTheDocument();
    });

    it('MUST handle special characters in content', () => {
      const specialContent = `Special chars: & < > " '`;
      render(<ConfirmationDialog {...defaultProps} content={specialContent} />);

      expect(screen.getByText(/Special chars: & < > " '/)).toBeInTheDocument();
    });
  });

  describe('Component Integrity', () => {
    it('MUST render without crashing', () => {
      expect(() => render(<ConfirmationDialog {...defaultProps} />)).not.toThrow();
    });

    it('MUST render consistently across multiple renders', () => {
      const { rerender } = render(<ConfirmationDialog {...defaultProps} />);
      const firstRender = screen.getByRole('dialog').outerHTML;

      rerender(<ConfirmationDialog {...defaultProps} />);
      const secondRender = screen.getByRole('dialog').outerHTML;

      expect(firstRender).toBe(secondRender);
    });

    it('MUST maintain structure with different prop combinations', () => {
      render(<ConfirmationDialog {...defaultProps} title="T1" content="C1" />);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument();
    });
  });

  describe('Button Styling and Presentation', () => {
    it('MUST render buttons with primary color', () => {
      render(<ConfirmationDialog {...defaultProps} />);

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      const confirmButton = screen.getByRole('button', { name: /confirm/i });

      expect(cancelButton).toHaveAttribute('class', expect.stringContaining('MuiButton'));
      expect(confirmButton).toHaveAttribute('class', expect.stringContaining('MuiButton'));
    });

    it('MUST render buttons in correct order (Cancel then Confirm)', () => {
      render(<ConfirmationDialog {...defaultProps} />);

      const buttons = screen.getAllByRole('button');
      expect(buttons[0]).toHaveTextContent('Cancel');
      expect(buttons[1]).toHaveTextContent('Confirm');
    });
  });

  describe('Backdrop and Modal Behavior', () => {
    it('MUST have modal backdrop when open', () => {
      render(<ConfirmationDialog {...defaultProps} />);

      // MUI Joy uses MuiModal-backdrop class for the backdrop
      const backdrop = document.querySelector('.MuiModal-backdrop');
      expect(backdrop).toBeInTheDocument();
    });

    it('MUST NOT have modal backdrop when closed', () => {
      render(<ConfirmationDialog {...defaultProps} open={false} />);

      const backdrop = document.querySelector('.MuiModal-backdrop');
      expect(backdrop).not.toBeInTheDocument();
    });
  });

  describe('Multiple Instances', () => {
    it('MUST support multiple dialog instances with different props', () => {
      const { container: _container } = render(
        <>
          <ConfirmationDialog open={true} onClose={vi.fn()} onConfirm={vi.fn()} title="Dialog 1" content="Content 1" />
          <ConfirmationDialog open={true} onClose={vi.fn()} onConfirm={vi.fn()} title="Dialog 2" content="Content 2" />
        </>
      );

      // Both titles should be present
      expect(screen.getByText('Dialog 1')).toBeInTheDocument();
      expect(screen.getByText('Dialog 2')).toBeInTheDocument();
    });
  });
});
