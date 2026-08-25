import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import UnauthenticatedSidebar from './unauthenticatedsidebar';
import { useSession } from 'next-auth/react';

// Mock dependencies
vi.mock('next-auth/react');
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() })
}));
vi.mock('@/ailogger', () => ({
  default: {
    error: vi.fn()
  }
}));

// UnauthenticatedSidebar renders inside the login page's centered card, so it must
// provide only the authentication controls: no viewport-height sidebar chrome and no
// second "ForestGEO" heading competing with the card's own h1.
describe('UnauthenticatedSidebar - Functional Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useSession as any).mockReturnValue({
      data: null,
      status: 'unauthenticated'
    });
  });

  describe('Card-content contract', () => {
    it('MUST have region landmark for authentication controls', () => {
      render(<UnauthenticatedSidebar />);

      const region = screen.getByRole('region', { name: 'Authentication controls' });
      expect(region).toHaveAttribute('aria-label', 'Authentication controls');
    });

    it('MUST have data-testid for component identification', () => {
      render(<UnauthenticatedSidebar />);

      expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    });

    it('MUST NOT render its own heading — the login card owns the ForestGEO branding', () => {
      render(<UnauthenticatedSidebar />);

      expect(screen.queryByRole('heading')).not.toBeInTheDocument();
      expect(screen.queryByText('ForestGEO')).not.toBeInTheDocument();
    });

    it('MUST NOT render full-viewport sidebar chrome inside the card', () => {
      const { container } = render(<UnauthenticatedSidebar />);

      expect(container.querySelector('aside')).not.toBeInTheDocument();
      const region = screen.getByTestId('sidebar');
      expect(region).not.toHaveStyle({ height: '100dvh' });
    });
  });

  describe('Integration with LoginLogout', () => {
    it('MUST render LoginLogout within the authentication controls region', () => {
      render(<UnauthenticatedSidebar />);

      const region = screen.getByRole('region', { name: 'Authentication controls' });
      expect(within(region).getByText('Login to access')).toBeInTheDocument();
      expect(within(region).getByText('your information')).toBeInTheDocument();
      expect(within(region).getByRole('button', { name: /login/i })).toBeInTheDocument();
    });

    it('MUST pass through to LoginLogout when authenticated', () => {
      (useSession as any).mockReturnValue({
        data: {
          user: {
            name: 'Test User',
            email: 'test@example.com',
            userStatus: 'user'
          }
        },
        status: 'authenticated'
      });

      render(<UnauthenticatedSidebar />);

      expect(screen.getByText('Test User')).toBeInTheDocument();
      expect(screen.getByText('test@example.com')).toBeInTheDocument();
    });
  });

  describe('Component Integrity', () => {
    it('MUST render without crashing', () => {
      expect(() => render(<UnauthenticatedSidebar />)).not.toThrow();
    });

    it('MUST render consistently across multiple renders', () => {
      const { rerender } = render(<UnauthenticatedSidebar />);
      const firstRender = screen.getByTestId('sidebar').outerHTML;

      rerender(<UnauthenticatedSidebar />);
      const secondRender = screen.getByTestId('sidebar').outerHTML;

      expect(firstRender).toBe(secondRender);
    });
  });
});
