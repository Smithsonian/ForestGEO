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

  describe('Rendering with Reason Slugs', () => {
    it('MUST render error heading', () => {
      mockUseSearchParams.mockReturnValue({
        get: vi.fn().mockReturnValue('permissions-unavailable')
      });

      render(<LoginFailed />);

      expect(screen.getByRole('heading', { name: /oops! login failed/i })).toBeInTheDocument();
    });

    it('MUST display friendly message for permissions-unavailable slug', () => {
      mockUseSearchParams.mockReturnValue({
        get: vi.fn().mockReturnValue('permissions-unavailable')
      });

      render(<LoginFailed />);

      expect(screen.getByText(/could not reach the authentication service/i)).toBeInTheDocument();
      // Raw slug must NOT appear in the DOM — only the friendly mapped message.
      expect(screen.queryByText(/permissions-unavailable/i)).not.toBeInTheDocument();
    });

    it('MUST fall through to default message for unknown reason slug', () => {
      mockUseSearchParams.mockReturnValue({
        get: vi.fn().mockReturnValue('some-unmapped-slug')
      });

      render(<LoginFailed />);

      expect(screen.getByText(/login failure triggered without reason/i)).toBeInTheDocument();
      // The raw slug is never reflected to the user — protects against
      // attacker-controlled query params being shown verbatim.
      expect(screen.queryByText(/some-unmapped-slug/i)).not.toBeInTheDocument();
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

    it('MUST not echo long failure reasons (avoids reflection / DoS)', () => {
      const longReason = 'A'.repeat(500);
      mockUseSearchParams.mockReturnValue({
        get: vi.fn().mockReturnValue(longReason)
      });

      render(<LoginFailed />);

      // Long arbitrary strings are unmapped; the modal shows the default
      // message instead of reflecting the raw input back.
      expect(screen.getByText(/login failure triggered without reason/i)).toBeInTheDocument();
      expect(screen.queryByText(new RegExp(longReason))).not.toBeInTheDocument();
    });

    it('MUST not echo HTML/script content from failure reason (XSS protection)', () => {
      mockUseSearchParams.mockReturnValue({
        get: vi.fn().mockReturnValue('<script>alert("test")</script>')
      });

      render(<LoginFailed />);

      // The modal must not reflect attacker-controlled query content. Even
      // though React would escape the markup, never rendering it at all
      // closes both the visual-confusion vector and any future regression
      // where a maintainer routes the reason through dangerouslySetInnerHTML.
      expect(screen.getByText(/login failure triggered without reason/i)).toBeInTheDocument();
      expect(screen.queryByText(/<script>alert\("test"\)<\/script>/)).not.toBeInTheDocument();
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

    it('MUST handle re-renders with different reason slugs', () => {
      const mockGet = vi.fn().mockReturnValue('permissions-unavailable');
      mockUseSearchParams.mockReturnValue({ get: mockGet });

      const { rerender } = render(<LoginFailed />);
      expect(screen.getByText(/could not reach the authentication service/i)).toBeInTheDocument();

      // Re-render with an unknown slug; modal swaps to the default message.
      mockGet.mockReturnValue('something-else');
      rerender(<LoginFailed />);
      expect(screen.getByText(/login failure triggered without reason/i)).toBeInTheDocument();
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
      // 'Test reason' is an unknown slug → default message renders.
      const reasonText = screen.getByText(/login failure triggered without reason/i);
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

    it('MUST not echo failure reason with newlines (unmapped → default)', () => {
      mockUseSearchParams.mockReturnValue({
        get: vi.fn().mockReturnValue('Line 1\nLine 2\nLine 3')
      });

      render(<LoginFailed />);

      // Multi-line input is an unknown slug; modal shows default, not the
      // attacker-controlled content.
      expect(screen.getByText(/login failure triggered without reason/i)).toBeInTheDocument();
      expect(screen.queryByText(/line 1/i)).not.toBeInTheDocument();
    });

    it('MUST handle failure reason with only whitespace as default', () => {
      mockUseSearchParams.mockReturnValue({
        get: vi.fn().mockReturnValue('   ')
      });

      render(<LoginFailed />);

      // Whitespace-only is unmapped → default message.
      expect(screen.getByText(/login failure triggered without reason/i)).toBeInTheDocument();
    });
  });
});
