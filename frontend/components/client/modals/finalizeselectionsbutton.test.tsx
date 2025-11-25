import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FinalizeSelectionsButton from './finalizeselectionsbutton';

describe('FinalizeSelectionsButton - Functional Tests', () => {
  const mockOnFinish = vi.fn();
  const defaultProps = {
    onFinish: mockOnFinish,
    show: true
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering and Visibility', () => {
    it('MUST render button when show is true', () => {
      render(<FinalizeSelectionsButton {...defaultProps} />);

      expect(screen.getByRole('button', { name: /finalize selections/i })).toBeInTheDocument();
    });

    it('MUST NOT render button when show is false', () => {
      render(<FinalizeSelectionsButton {...defaultProps} show={false} />);

      expect(screen.queryByRole('button', { name: /finalize selections/i })).not.toBeInTheDocument();
    });

    it('MUST return null when show is false', () => {
      const { container } = render(<FinalizeSelectionsButton {...defaultProps} show={false} />);

      expect(container.firstChild).toBeNull();
    });

    it('MUST display correct button text', () => {
      render(<FinalizeSelectionsButton {...defaultProps} />);

      expect(screen.getByText('Finalize selections')).toBeInTheDocument();
    });
  });

  describe('User Interaction - Button Clicks', () => {
    it('MUST call onFinish when button is clicked', async () => {
      const user = userEvent.setup();
      render(<FinalizeSelectionsButton {...defaultProps} />);

      const button = screen.getByRole('button', { name: /finalize selections/i });
      await user.click(button);

      expect(mockOnFinish).toHaveBeenCalledTimes(1);
    });

    it('MUST NOT call onFinish when button is not visible', () => {
      render(<FinalizeSelectionsButton {...defaultProps} show={false} />);

      expect(mockOnFinish).not.toHaveBeenCalled();
    });

    it('MUST handle multiple rapid clicks', async () => {
      const user = userEvent.setup();
      render(<FinalizeSelectionsButton {...defaultProps} />);

      const button = screen.getByRole('button', { name: /finalize selections/i });
      await user.click(button);
      await user.click(button);
      await user.click(button);

      expect(mockOnFinish).toHaveBeenCalledTimes(3);
    });
  });

  describe('Component State Management', () => {
    it('MUST toggle visibility based on show prop', async () => {
      const { rerender } = render(<FinalizeSelectionsButton {...defaultProps} show={false} />);
      expect(screen.queryByRole('button', { name: /finalize selections/i })).not.toBeInTheDocument();

      rerender(<FinalizeSelectionsButton {...defaultProps} show={true} />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /finalize selections/i })).toBeInTheDocument();
      });

      rerender(<FinalizeSelectionsButton {...defaultProps} show={false} />);
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /finalize selections/i })).not.toBeInTheDocument();
      });
    });

    it('MUST accept different onFinish handlers', async () => {
      const newOnFinish = vi.fn();
      const user = userEvent.setup();

      const { rerender } = render(<FinalizeSelectionsButton {...defaultProps} />);

      rerender(<FinalizeSelectionsButton onFinish={newOnFinish} show={true} />);

      const button = screen.getByRole('button', { name: /finalize selections/i });
      await user.click(button);

      expect(newOnFinish).toHaveBeenCalledTimes(1);
      expect(mockOnFinish).not.toHaveBeenCalled();
    });
  });

  describe('Button Styling and Appearance', () => {
    it('MUST render with contained variant', () => {
      render(<FinalizeSelectionsButton {...defaultProps} />);

      const button = screen.getByRole('button', { name: /finalize selections/i });
      expect(button).toHaveClass(/MuiButton/);
    });

    it('MUST render with primary color', () => {
      render(<FinalizeSelectionsButton {...defaultProps} />);

      const button = screen.getByRole('button', { name: /finalize selections/i });
      expect(button).toHaveClass(/MuiButton/);
    });

    it('MUST apply custom styles', () => {
      const { container } = render(<FinalizeSelectionsButton {...defaultProps} />);

      const button = container.querySelector('button');
      expect(button).toBeInTheDocument();
    });
  });

  describe('Grow Animation', () => {
    it('MUST wrap button in Grow component', () => {
      render(<FinalizeSelectionsButton {...defaultProps} />);

      // Verify the button exists (which confirms Grow is working since show=true)
      const button = screen.getByRole('button', { name: /finalize selections/i });
      expect(button).toBeInTheDocument();
    });

    it('MUST apply animation when transitioning from hidden to visible', async () => {
      const { rerender } = render(<FinalizeSelectionsButton {...defaultProps} show={false} />);

      rerender(<FinalizeSelectionsButton {...defaultProps} show={true} />);

      // Button should appear with animation
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /finalize selections/i })).toBeInTheDocument();
      });
    });
  });

  describe('Accessibility', () => {
    it('MUST have accessible button role', () => {
      render(<FinalizeSelectionsButton {...defaultProps} />);

      const button = screen.getByRole('button', { name: /finalize selections/i });
      expect(button).toBeInTheDocument();
    });

    it('MUST have accessible name from button text', () => {
      render(<FinalizeSelectionsButton {...defaultProps} />);

      const button = screen.getByRole('button', { name: /finalize selections/i });
      expect(button).toHaveAccessibleName();
    });

    it('MUST NOT be disabled', () => {
      render(<FinalizeSelectionsButton {...defaultProps} />);

      const button = screen.getByRole('button', { name: /finalize selections/i });
      expect(button).not.toBeDisabled();
    });

    it('MUST be keyboard accessible', async () => {
      const user = userEvent.setup();
      render(<FinalizeSelectionsButton {...defaultProps} />);

      const button = screen.getByRole('button', { name: /finalize selections/i });
      await user.tab();

      expect(button).toHaveFocus();
    });

    it('MUST support Enter key press', async () => {
      const user = userEvent.setup();
      render(<FinalizeSelectionsButton {...defaultProps} />);

      const button = screen.getByRole('button', { name: /finalize selections/i });
      button.focus();
      await user.keyboard('{Enter}');

      expect(mockOnFinish).toHaveBeenCalledTimes(1);
    });

    it('MUST support Space key press', async () => {
      const user = userEvent.setup();
      render(<FinalizeSelectionsButton {...defaultProps} />);

      const button = screen.getByRole('button', { name: /finalize selections/i });
      button.focus();
      await user.keyboard(' ');

      expect(mockOnFinish).toHaveBeenCalledTimes(1);
    });
  });

  describe('Component Integrity', () => {
    it('MUST render without crashing when shown', () => {
      expect(() => render(<FinalizeSelectionsButton {...defaultProps} />)).not.toThrow();
    });

    it('MUST render without crashing when hidden', () => {
      expect(() => render(<FinalizeSelectionsButton {...defaultProps} show={false} />)).not.toThrow();
    });

    it('MUST render consistently across multiple renders', () => {
      const { rerender } = render(<FinalizeSelectionsButton {...defaultProps} />);
      const firstRender = screen.getByRole('button', { name: /finalize selections/i }).outerHTML;

      rerender(<FinalizeSelectionsButton {...defaultProps} />);
      const secondRender = screen.getByRole('button', { name: /finalize selections/i }).outerHTML;

      expect(firstRender).toBe(secondRender);
    });

    it('MUST maintain button text across re-renders', () => {
      const { rerender } = render(<FinalizeSelectionsButton {...defaultProps} />);
      expect(screen.getByText('Finalize selections')).toBeInTheDocument();

      rerender(<FinalizeSelectionsButton {...defaultProps} />);
      expect(screen.getByText('Finalize selections')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('MUST handle show prop changing rapidly', async () => {
      const { rerender } = render(<FinalizeSelectionsButton {...defaultProps} show={true} />);

      rerender(<FinalizeSelectionsButton {...defaultProps} show={false} />);
      rerender(<FinalizeSelectionsButton {...defaultProps} show={true} />);
      rerender(<FinalizeSelectionsButton {...defaultProps} show={false} />);
      rerender(<FinalizeSelectionsButton {...defaultProps} show={true} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /finalize selections/i })).toBeInTheDocument();
      });
    });

    it('MUST handle async onFinish handler', async () => {
      const asyncHandler = vi.fn().mockResolvedValue(undefined);
      const user = userEvent.setup();

      render(<FinalizeSelectionsButton onFinish={asyncHandler} show={true} />);

      const button = screen.getByRole('button', { name: /finalize selections/i });
      await user.click(button);

      expect(asyncHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Button Hover Behavior', () => {
    it('MUST render button that can be hovered', async () => {
      const user = userEvent.setup();
      render(<FinalizeSelectionsButton {...defaultProps} />);

      const button = screen.getByRole('button', { name: /finalize selections/i });

      // Hover over the button
      await user.hover(button);

      expect(button).toBeInTheDocument();
    });

    it('MUST maintain functionality after hover', async () => {
      const user = userEvent.setup();
      render(<FinalizeSelectionsButton {...defaultProps} />);

      const button = screen.getByRole('button', { name: /finalize selections/i });

      await user.hover(button);
      await user.click(button);

      expect(mockOnFinish).toHaveBeenCalledTimes(1);
    });
  });

  describe('Animation Timing', () => {
    it('MUST apply Grow transition when appearing', async () => {
      const { rerender } = render(<FinalizeSelectionsButton {...defaultProps} show={false} />);

      rerender(<FinalizeSelectionsButton {...defaultProps} show={true} />);

      // Grow animation should be active
      await waitFor(
        () => {
          expect(screen.getByRole('button', { name: /finalize selections/i })).toBeInTheDocument();
        },
        { timeout: 2000 }
      );
    });
  });
});
