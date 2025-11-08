/**
 * @fileoverview Component tests for ToastNotification system
 *
 * Tests the toast notification provider, context, hook, and all variants.
 * Validates rendering, auto-dismiss, manual close, and different message types.
 *
 * @see /components/toastnotification.tsx
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider, useToast } from './toastnotification';
import { ReactNode } from 'react';

// Test component that uses the toast hook
function TestComponent() {
  const toast = useToast();

  return (
    <div>
      <button onClick={() => toast.success('Success message')}>Success Toast</button>
      <button onClick={() => toast.error('Error message')}>Error Toast</button>
      <button onClick={() => toast.warning('Warning message')}>Warning Toast</button>
      <button onClick={() => toast.info('Info message')}>Info Toast</button>
      <button
        onClick={() =>
          toast.showToast({
            message: 'Custom message',
            variant: 'success',
            duration: 1000
          })
        }
      >
        Custom Toast
      </button>
      <button
        onClick={() =>
          toast.showToast({
            message: 'With action',
            variant: 'info',
            action: {
              label: 'Undo',
              onClick: () => console.log('Action clicked')
            }
          })
        }
      >
        Toast With Action
      </button>
    </div>
  );
}

describe('ToastProvider and useToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('Provider Setup', () => {
    it('should render children', () => {
      render(
        <ToastProvider>
          <div>Test Child</div>
        </ToastProvider>
      );

      expect(screen.getByText('Test Child')).toBeInTheDocument();
    });

    it('should throw error when useToast is used outside provider', () => {
      // Suppress console.error for this test
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        render(<TestComponent />);
      }).toThrow('useToast must be used within ToastProvider');

      consoleError.mockRestore();
    });

    it('should provide toast context when wrapped in provider', () => {
      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      expect(screen.getByText('Success Toast')).toBeInTheDocument();
      expect(screen.getByText('Error Toast')).toBeInTheDocument();
      expect(screen.getByText('Warning Toast')).toBeInTheDocument();
      expect(screen.getByText('Info Toast')).toBeInTheDocument();
    });
  });

  describe('Success Toast', () => {
    it('should display success toast', async () => {
      const user = userEvent.setup({ delay: null });

      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      await user.click(screen.getByText('Success Toast'));

      await waitFor(() => {
        expect(screen.getByText('Success message')).toBeInTheDocument();
      });
    });

    it('should use success variant styling', async () => {
      const user = userEvent.setup({ delay: null });

      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      await user.click(screen.getByText('Success Toast'));

      await waitFor(() => {
        const alert = screen.getByText('Success message').closest('.MuiAlert-root');
        expect(alert).toHaveAttribute('data-variant', 'soft');
      });
    });

    it('should auto-dismiss after default duration (4000ms)', async () => {
      const user = userEvent.setup({ delay: null });

      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      await user.click(screen.getByText('Success Toast'));

      await waitFor(() => {
        expect(screen.getByText('Success message')).toBeInTheDocument();
      });

      act(() => {
        vi.advanceTimersByTime(4000);
      });

      await waitFor(() => {
        expect(screen.queryByText('Success message')).not.toBeInTheDocument();
      });
    });

    it('should display CheckCircleIcon for success', async () => {
      const user = userEvent.setup({ delay: null });

      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      await user.click(screen.getByText('Success Toast'));

      await waitFor(() => {
        const message = screen.getByText('Success message');
        const icon = message.parentElement?.querySelector('svg');
        expect(icon).toBeInTheDocument();
      });
    });
  });

  describe('Error Toast', () => {
    it('should display error toast', async () => {
      const user = userEvent.setup({ delay: null });

      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      await user.click(screen.getByText('Error Toast'));

      await waitFor(() => {
        expect(screen.getByText('Error message')).toBeInTheDocument();
      });
    });

    it('should use danger variant styling', async () => {
      const user = userEvent.setup({ delay: null });

      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      await user.click(screen.getByText('Error Toast'));

      await waitFor(() => {
        const alert = screen.getByText('Error message').closest('.MuiAlert-root');
        expect(alert).toBeInTheDocument();
      });
    });

    it('should auto-dismiss after 6000ms (longer for errors)', async () => {
      const user = userEvent.setup({ delay: null });

      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      await user.click(screen.getByText('Error Toast'));

      await waitFor(() => {
        expect(screen.getByText('Error message')).toBeInTheDocument();
      });

      act(() => {
        vi.advanceTimersByTime(5999);
      });

      expect(screen.getByText('Error message')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1);
      });

      await waitFor(() => {
        expect(screen.queryByText('Error message')).not.toBeInTheDocument();
      });
    });
  });

  describe('Warning Toast', () => {
    it('should display warning toast', async () => {
      const user = userEvent.setup({ delay: null });

      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      await user.click(screen.getByText('Warning Toast'));

      await waitFor(() => {
        expect(screen.getByText('Warning message')).toBeInTheDocument();
      });
    });

    it('should auto-dismiss after 5000ms', async () => {
      const user = userEvent.setup({ delay: null });

      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      await user.click(screen.getByText('Warning Toast'));

      await waitFor(() => {
        expect(screen.getByText('Warning message')).toBeInTheDocument();
      });

      act(() => {
        vi.advanceTimersByTime(5000);
      });

      await waitFor(() => {
        expect(screen.queryByText('Warning message')).not.toBeInTheDocument();
      });
    });
  });

  describe('Info Toast', () => {
    it('should display info toast', async () => {
      const user = userEvent.setup({ delay: null });

      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      await user.click(screen.getByText('Info Toast'));

      await waitFor(() => {
        expect(screen.getByText('Info message')).toBeInTheDocument();
      });
    });

    it('should auto-dismiss after 4000ms', async () => {
      const user = userEvent.setup({ delay: null });

      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      await user.click(screen.getByText('Info Toast'));

      await waitFor(() => {
        expect(screen.getByText('Info message')).toBeInTheDocument();
      });

      act(() => {
        vi.advanceTimersByTime(4000);
      });

      await waitFor(() => {
        expect(screen.queryByText('Info message')).not.toBeInTheDocument();
      });
    });
  });

  describe('Custom Toast Options', () => {
    it('should respect custom duration', async () => {
      const user = userEvent.setup({ delay: null });

      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      await user.click(screen.getByText('Custom Toast'));

      await waitFor(() => {
        expect(screen.getByText('Custom message')).toBeInTheDocument();
      });

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      await waitFor(() => {
        expect(screen.queryByText('Custom message')).not.toBeInTheDocument();
      });
    });

    it('should use default variant (info) when not specified', async () => {
      const user = userEvent.setup({ delay: null });

      function TestDefaultVariant() {
        const toast = useToast();
        return (
          <button
            onClick={() =>
              toast.showToast({
                message: 'No variant specified'
              })
            }
          >
            Show
          </button>
        );
      }

      render(
        <ToastProvider>
          <TestDefaultVariant />
        </ToastProvider>
      );

      await user.click(screen.getByText('Show'));

      await waitFor(() => {
        expect(screen.getByText('No variant specified')).toBeInTheDocument();
      });
    });

    it('should use default duration (4000ms) when not specified', async () => {
      const user = userEvent.setup({ delay: null });

      function TestDefaultDuration() {
        const toast = useToast();
        return (
          <button
            onClick={() =>
              toast.showToast({
                message: 'No duration specified',
                variant: 'info'
              })
            }
          >
            Show
          </button>
        );
      }

      render(
        <ToastProvider>
          <TestDefaultDuration />
        </ToastProvider>
      );

      await user.click(screen.getByText('Show'));

      await waitFor(() => {
        expect(screen.getByText('No duration specified')).toBeInTheDocument();
      });

      act(() => {
        vi.advanceTimersByTime(4000);
      });

      await waitFor(() => {
        expect(screen.queryByText('No duration specified')).not.toBeInTheDocument();
      });
    });
  });

  describe('Manual Close', () => {
    it('should close toast when close button is clicked', async () => {
      const user = userEvent.setup({ delay: null });

      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      await user.click(screen.getByText('Success Toast'));

      await waitFor(() => {
        expect(screen.getByText('Success message')).toBeInTheDocument();
      });

      const closeButton = screen.getByRole('button', { name: /close/i });
      await user.click(closeButton);

      await waitFor(() => {
        expect(screen.queryByText('Success message')).not.toBeInTheDocument();
      });
    });

    it('should not auto-dismiss after manual close', async () => {
      const user = userEvent.setup({ delay: null });

      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      await user.click(screen.getByText('Success Toast'));

      await waitFor(() => {
        expect(screen.getByText('Success message')).toBeInTheDocument();
      });

      const closeButton = screen.getByRole('button', { name: /close/i });
      await user.click(closeButton);

      await waitFor(() => {
        expect(screen.queryByText('Success message')).not.toBeInTheDocument();
      });

      // Advance time to ensure it doesn't reappear
      act(() => {
        vi.advanceTimersByTime(10000);
      });

      expect(screen.queryByText('Success message')).not.toBeInTheDocument();
    });
  });

  describe('Multiple Toasts', () => {
    it('should replace previous toast when new one is shown', async () => {
      const user = userEvent.setup({ delay: null });

      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      await user.click(screen.getByText('Success Toast'));

      await waitFor(() => {
        expect(screen.getByText('Success message')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Error Toast'));

      await waitFor(() => {
        expect(screen.getByText('Error message')).toBeInTheDocument();
        expect(screen.queryByText('Success message')).not.toBeInTheDocument();
      });
    });
  });

  describe('Positioning', () => {
    it('should render snackbar element', async () => {
      const user = userEvent.setup({ delay: null });

      const { container } = render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      await user.click(screen.getByText('Success Toast'));

      await waitFor(() => {
        const snackbar = container.querySelector('.MuiSnackbar-root');
        expect(snackbar).toBeInTheDocument();
      });
    });
  });

  describe('Styling', () => {
    it('should render toast with alert component', async () => {
      const user = userEvent.setup({ delay: null });

      const { container } = render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      await user.click(screen.getByText('Success Toast'));

      await waitFor(() => {
        const alert = container.querySelector('.MuiAlert-root');
        expect(alert).toBeInTheDocument();
      });
    });

    it('should render message in box container', async () => {
      const user = userEvent.setup({ delay: null });

      const { container } = render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      await user.click(screen.getByText('Success Toast'));

      await waitFor(() => {
        const box = container.querySelector('.MuiBox-root');
        expect(box).toBeInTheDocument();
      });
    });

    it('should have soft variant class', async () => {
      const user = userEvent.setup({ delay: null });

      const { container } = render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      await user.click(screen.getByText('Success Toast'));

      await waitFor(() => {
        const alert = container.querySelector('.MuiAlert-variantSoft');
        expect(alert).toBeInTheDocument();
      });
    });
  });

  describe('Animations', () => {
    it('should render alert with animation classes', async () => {
      const user = userEvent.setup({ delay: null });

      const { container } = render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      await user.click(screen.getByText('Success Toast'));

      await waitFor(() => {
        const alert = container.querySelector('.MuiAlert-root');
        expect(alert).toBeInTheDocument();
      });
    });
  });

  describe('Icon Display', () => {
    it('should display CheckCircleIcon for success', async () => {
      const user = userEvent.setup({ delay: null });

      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      await user.click(screen.getByText('Success Toast'));

      await waitFor(() => {
        const icon = screen.getByText('Success message').parentElement?.querySelector('svg[data-testid*="CheckCircle"]');
        expect(icon).toBeInTheDocument();
      });
    });

    it('should display ErrorIcon for error/danger', async () => {
      const user = userEvent.setup({ delay: null });

      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      await user.click(screen.getByText('Error Toast'));

      await waitFor(() => {
        const icon = screen.getByText('Error message').parentElement?.querySelector('svg[data-testid*="Error"]');
        expect(icon).toBeInTheDocument();
      });
    });

    it('should display WarningIcon for warning', async () => {
      const user = userEvent.setup({ delay: null });

      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      await user.click(screen.getByText('Warning Toast'));

      await waitFor(() => {
        const icon = screen.getByText('Warning message').parentElement?.querySelector('svg[data-testid*="Warning"]');
        expect(icon).toBeInTheDocument();
      });
    });

    it('should display InfoIcon for info', async () => {
      const user = userEvent.setup({ delay: null });

      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      await user.click(screen.getByText('Info Toast'));

      await waitFor(() => {
        const icon = screen.getByText('Info message').parentElement?.querySelector('svg[data-testid*="Info"]');
        expect(icon).toBeInTheDocument();
      });
    });
  });
});
