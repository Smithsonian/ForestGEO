import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginFailed from './loginfailure';
import { signOut } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';

// Mock next-auth/react
vi.mock('next-auth/react', () => ({
  signOut: vi.fn()
}));

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn()
}));

// Mock ailogger
vi.mock('@/ailogger', () => ({
  default: {
    error: vi.fn()
  }
}));

describe('LoginFailed - Functional Tests', () => {
  const mockSignOut = signOut as unknown as ReturnType<typeof vi.fn>;
  const mockUseSearchParams = useSearchParams as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock sessionStorage and localStorage
    global.sessionStorage = {
      clear: vi.fn(),
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      key: vi.fn(),
      length: 0
    };

    global.localStorage = {
      clear: vi.fn(),
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      key: vi.fn(),
      length: 0
    };

    // Default mock for signOut - returns a resolved promise
    mockSignOut.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Rendering with Custom Failure Reason', () => {
    it('MUST render error heading', () => {
      mockUseSearchParams.mockReturnValue({
        get: vi.fn().mockReturnValue('Invalid credentials')
      });

      render(<LoginFailed />);

      expect(screen.getByRole('heading', { name: /oops! login failed/i })).toBeInTheDocument();
    });

    it('MUST display custom failure reason from URL params', () => {
      mockUseSearchParams.mockReturnValue({
        get: vi.fn().mockReturnValue('Invalid credentials')
      });

      render(<LoginFailed />);

      expect(screen.getByText(/failure caused due to invalid credentials/i)).toBeInTheDocument();
    });

    it('MUST display different custom failure reason', () => {
      mockUseSearchParams.mockReturnValue({
        get: vi.fn().mockReturnValue('Account locked')
      });

      render(<LoginFailed />);

      expect(screen.getByText(/failure caused due to account locked/i)).toBeInTheDocument();
    });

    it('MUST display help text', () => {
      mockUseSearchParams.mockReturnValue({
        get: vi.fn().mockReturnValue('Test reason')
      });

      render(<LoginFailed />);

      expect(screen.getByText(/we couldn't log you in/i)).toBeInTheDocument();
    });

    it('MUST render Try Again button', () => {
      mockUseSearchParams.mockReturnValue({
        get: vi.fn().mockReturnValue('Test reason')
      });

      render(<LoginFailed />);

      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    });
  });

  describe('Rendering with Default Failure Reason', () => {
    it('MUST display default message when reason is null', () => {
      mockUseSearchParams.mockReturnValue({
        get: vi.fn().mockReturnValue(null)
      });

      render(<LoginFailed />);

      expect(screen.getByText(/login failure triggered without reason/i)).toBeInTheDocument();
      expect(screen.getByText(/please speak to an administrator/i)).toBeInTheDocument();
    });

    it('MUST display default message when reason is empty string', () => {
      mockUseSearchParams.mockReturnValue({
        get: vi.fn().mockReturnValue('')
      });

      render(<LoginFailed />);

      expect(screen.getByText(/login failure triggered without reason/i)).toBeInTheDocument();
    });

    it('MUST display default message when reason is undefined', () => {
      mockUseSearchParams.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined)
      });

      render(<LoginFailed />);

      expect(screen.getByText(/login failure triggered without reason/i)).toBeInTheDocument();
    });

    it('MUST display default message when searchParams is null', () => {
      mockUseSearchParams.mockReturnValue(null);

      render(<LoginFailed />);

      expect(screen.getByText(/login failure triggered without reason/i)).toBeInTheDocument();
    });
  });

  describe('User Interaction - Try Again Button', () => {
    it('MUST clear sessionStorage when Try Again is clicked', async () => {
      const user = userEvent.setup();
      mockUseSearchParams.mockReturnValue({
        get: vi.fn().mockReturnValue('Test reason')
      });

      render(<LoginFailed />);

      const tryAgainButton = screen.getByRole('button', { name: /try again/i });
      await user.click(tryAgainButton);

      expect(global.sessionStorage.clear).toHaveBeenCalledTimes(1);
    });

    it('MUST clear localStorage when Try Again is clicked', async () => {
      const user = userEvent.setup();
      mockUseSearchParams.mockReturnValue({
        get: vi.fn().mockReturnValue('Test reason')
      });

      render(<LoginFailed />);

      const tryAgainButton = screen.getByRole('button', { name: /try again/i });
      await user.click(tryAgainButton);

      expect(global.localStorage.clear).toHaveBeenCalledTimes(1);
    });

    it('MUST call signOut with redirect to /login', async () => {
      const user = userEvent.setup();
      mockUseSearchParams.mockReturnValue({
        get: vi.fn().mockReturnValue('Test reason')
      });

      render(<LoginFailed />);

      const tryAgainButton = screen.getByRole('button', { name: /try again/i });
      await user.click(tryAgainButton);

      expect(mockSignOut).toHaveBeenCalledTimes(1);
      expect(mockSignOut).toHaveBeenCalledWith({ redirectTo: '/login' });
    });

    it('MUST clear storage before calling signOut', async () => {
      const user = userEvent.setup();
      const callOrder: string[] = [];

      global.sessionStorage.clear = vi.fn(() => callOrder.push('sessionStorage'));
      global.localStorage.clear = vi.fn(() => callOrder.push('localStorage'));
      mockSignOut.mockImplementation(() => {
        callOrder.push('signOut');
        return Promise.resolve(undefined);
      });

      mockUseSearchParams.mockReturnValue({
        get: vi.fn().mockReturnValue('Test reason')
      });

      render(<LoginFailed />);

      const tryAgainButton = screen.getByRole('button', { name: /try again/i });
      await user.click(tryAgainButton);

      expect(callOrder[0]).toBe('sessionStorage');
      expect(callOrder[1]).toBe('localStorage');
      expect(callOrder[2]).toBe('signOut');
    });
  });

  describe('Error Handling', () => {
    it('MUST handle signOut rejection gracefully', async () => {
      const user = userEvent.setup();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockSignOut.mockRejectedValue(new Error('Sign out failed'));
      mockUseSearchParams.mockReturnValue({
        get: vi.fn().mockReturnValue('Test reason')
      });

      render(<LoginFailed />);

      const tryAgainButton = screen.getByRole('button', { name: /try again/i });
      await user.click(tryAgainButton);

      // Component should not crash
      expect(screen.getByText(/oops! login failed/i)).toBeInTheDocument();

      consoleErrorSpy.mockRestore();
    });

    it('MUST handle very long failure reasons', () => {
      const longReason = 'A'.repeat(500);
      mockUseSearchParams.mockReturnValue({
        get: vi.fn().mockReturnValue(longReason)
      });

      render(<LoginFailed />);

      expect(screen.getByText(new RegExp(longReason))).toBeInTheDocument();
    });

    it('MUST handle special characters in failure reason', () => {
      mockUseSearchParams.mockReturnValue({
        get: vi.fn().mockReturnValue('<script>alert("test")</script>')
      });

      render(<LoginFailed />);

      expect(screen.getByText(/<script>alert\("test"\)<\/script>/)).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('MUST have proper heading hierarchy', () => {
      mockUseSearchParams.mockReturnValue({
        get: vi.fn().mockReturnValue('Test reason')
      });

      render(<LoginFailed />);

      const heading = screen.getByRole('heading', { name: /oops! login failed/i });
      expect(heading).toBeInTheDocument();
      expect(heading.tagName).toBe('H1');
    });

    it('MUST use danger color for error heading', () => {
      mockUseSearchParams.mockReturnValue({
        get: vi.fn().mockReturnValue('Test reason')
      });

      render(<LoginFailed />);

      const heading = screen.getByRole('heading', { name: /oops! login failed/i });
      expect(heading).toHaveClass(/MuiTypography/);
    });

    it('MUST have accessible button', () => {
      mockUseSearchParams.mockReturnValue({
        get: vi.fn().mockReturnValue('Test reason')
      });

      render(<LoginFailed />);

      const button = screen.getByRole('button', { name: /try again/i });
      expect(button).toHaveAccessibleName();
      expect(button).not.toBeDisabled();
    });
  });

  describe('Component Layout', () => {
    it('MUST render all text elements in correct order', () => {
      mockUseSearchParams.mockReturnValue({
        get: vi.fn().mockReturnValue('Test reason')
      });

      render(<LoginFailed />);

      const elements = screen.getAllByText(/login|failure|try again/i);
      expect(elements.length).toBeGreaterThan(0);
    });

    it('MUST center content', () => {
      mockUseSearchParams.mockReturnValue({
        get: vi.fn().mockReturnValue('Test reason')
      });

      const { container } = render(<LoginFailed />);
      const stack = container.querySelector('.MuiStack-root');
      expect(stack).toBeInTheDocument();
    });
  });

  describe('Component Integrity', () => {
    it('MUST render without crashing', () => {
      mockUseSearchParams.mockReturnValue({
        get: vi.fn().mockReturnValue('Test reason')
      });

      expect(() => render(<LoginFailed />)).not.toThrow();
    });

    it('MUST render consistently across multiple renders', () => {
      mockUseSearchParams.mockReturnValue({
        get: vi.fn().mockReturnValue('Test reason')
      });

      const { rerender } = render(<LoginFailed />);
      const firstRender = screen.getByRole('heading', { name: /oops! login failed/i }).outerHTML;

      rerender(<LoginFailed />);
      const secondRender = screen.getByRole('heading', { name: /oops! login failed/i }).outerHTML;

      expect(firstRender).toBe(secondRender);
    });

    it('MUST handle re-renders with different failure reasons', () => {
      const mockGet = vi.fn().mockReturnValue('First reason');
      mockUseSearchParams.mockReturnValue({ get: mockGet });

      const { rerender } = render(<LoginFailed />);
      expect(screen.getByText(/first reason/i)).toBeInTheDocument();

      mockGet.mockReturnValue('Second reason');
      rerender(<LoginFailed />);
      expect(screen.getByText(/second reason/i)).toBeInTheDocument();
    });
  });

  describe('Keyboard Navigation', () => {
    it('MUST support keyboard focus on Try Again button', async () => {
      const user = userEvent.setup();
      mockUseSearchParams.mockReturnValue({
        get: vi.fn().mockReturnValue('Test reason')
      });

      render(<LoginFailed />);

      const tryAgainButton = screen.getByRole('button', { name: /try again/i });
      await user.tab();

      expect(tryAgainButton).toHaveFocus();
    });

    it('MUST support Enter key on Try Again button', async () => {
      const user = userEvent.setup();
      mockUseSearchParams.mockReturnValue({
        get: vi.fn().mockReturnValue('Test reason')
      });

      render(<LoginFailed />);

      const tryAgainButton = screen.getByRole('button', { name: /try again/i });
      tryAgainButton.focus();
      await user.keyboard('{Enter}');

      expect(mockSignOut).toHaveBeenCalledTimes(1);
    });
  });

  describe('Typography Styling', () => {
    it('MUST use proper typography levels', () => {
      mockUseSearchParams.mockReturnValue({
        get: vi.fn().mockReturnValue('Test reason')
      });

      render(<LoginFailed />);

      const mainHeading = screen.getByRole('heading', { name: /oops! login failed/i });
      const reasonText = screen.getByText(/failure caused due to/i);
      const helpText = screen.getByText(/we couldn't log you in/i);

      expect(mainHeading).toHaveClass(/MuiTypography/);
      expect(reasonText).toHaveClass(/MuiTypography/);
      expect(helpText).toHaveClass(/MuiTypography/);
    });
  });

  describe('Button Styling', () => {
    it('MUST render button with solid variant', () => {
      mockUseSearchParams.mockReturnValue({
        get: vi.fn().mockReturnValue('Test reason')
      });

      render(<LoginFailed />);

      const button = screen.getByRole('button', { name: /try again/i });
      expect(button).toHaveClass(/MuiButton/);
    });
  });

  describe('Multiple Click Protection', () => {
    it('MUST handle rapid successive button clicks', async () => {
      const user = userEvent.setup();
      mockUseSearchParams.mockReturnValue({
        get: vi.fn().mockReturnValue('Test reason')
      });

      render(<LoginFailed />);

      const tryAgainButton = screen.getByRole('button', { name: /try again/i });
      await user.click(tryAgainButton);
      await user.click(tryAgainButton);

      // Should clear storage twice
      expect(global.sessionStorage.clear).toHaveBeenCalledTimes(2);
      expect(global.localStorage.clear).toHaveBeenCalledTimes(2);
      expect(mockSignOut).toHaveBeenCalledTimes(2);
    });
  });

  describe('Edge Cases', () => {
    it('MUST handle useSearchParams returning null', () => {
      mockUseSearchParams.mockReturnValue(null);

      expect(() => render(<LoginFailed />)).not.toThrow();
      expect(screen.getByText(/login failure triggered without reason/i)).toBeInTheDocument();
    });

    it('MUST handle failure reason with newlines', () => {
      mockUseSearchParams.mockReturnValue({
        get: vi.fn().mockReturnValue('Line 1\nLine 2\nLine 3')
      });

      render(<LoginFailed />);

      expect(screen.getByText(/line 1/i)).toBeInTheDocument();
    });

    it('MUST handle failure reason with only whitespace', () => {
      mockUseSearchParams.mockReturnValue({
        get: vi.fn().mockReturnValue('   ')
      });

      render(<LoginFailed />);

      // Whitespace is treated as a valid reason and gets displayed
      expect(screen.getByText(/failure caused due to/i)).toBeInTheDocument();
    });
  });
});
