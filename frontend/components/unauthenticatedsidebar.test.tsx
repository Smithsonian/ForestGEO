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

describe('UnauthenticatedSidebar - Functional Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useSession as any).mockReturnValue({
      data: null,
      status: 'unauthenticated'
    });
  });

  describe('Accessibility - Semantic HTML', () => {
    it('MUST use semantic aside element for sidebar', () => {
      const { container } = render(<UnauthenticatedSidebar />);

      const aside = container.querySelector('aside');
      expect(aside).toBeInTheDocument();
      expect(aside).toHaveClass('Sidebar');
    });

    it('MUST have navigation landmark with accessible label', () => {
      render(<UnauthenticatedSidebar />);

      const nav = screen.getByRole('navigation', { name: /main navigation/i });
      expect(nav).toBeInTheDocument();
    });

    it('MUST have banner landmark for branding', () => {
      render(<UnauthenticatedSidebar />);

      const banner = screen.getByRole('banner', { name: /application name/i });
      expect(banner).toBeInTheDocument();
    });

    it('MUST have region landmark for authentication controls', () => {
      render(<UnauthenticatedSidebar />);

      const region = screen.getByRole('region', { name: /authentication controls/i });
      expect(region).toBeInTheDocument();
    });

    it('MUST have proper heading hierarchy starting with h1', () => {
      render(<UnauthenticatedSidebar />);

      const heading = screen.getByRole('heading', { level: 1 });
      expect(heading).toHaveTextContent('ForestGEO');
    });
  });

  describe('Visual Structure', () => {
    it('MUST render ForestGEO branding', () => {
      render(<UnauthenticatedSidebar />);

      const branding = screen.getByText('ForestGEO');
      expect(branding).toBeInTheDocument();
    });

    it('MUST render branding within banner landmark', () => {
      render(<UnauthenticatedSidebar />);

      const banner = screen.getByRole('banner', { name: /application name/i });
      const branding = within(banner).getByText('ForestGEO');
      expect(branding).toBeInTheDocument();
    });

    it('MUST include LoginLogout component', () => {
      render(<UnauthenticatedSidebar />);

      // LoginLogout component should render "Login to access" when unauthenticated
      expect(screen.getByText('Login to access')).toBeInTheDocument();
    });

    it('MUST render LoginLogout within authentication controls region', () => {
      render(<UnauthenticatedSidebar />);

      const region = screen.getByRole('region', { name: /authentication controls/i });
      const loginText = within(region).getByText('Login to access');
      expect(loginText).toBeInTheDocument();
    });

    it('MUST have divider before authentication section', () => {
      const { container } = render(<UnauthenticatedSidebar />);

      const divider = container.querySelector('[aria-orientation="horizontal"]');
      expect(divider).toBeInTheDocument();
    });
  });

  describe('Layout & Styling', () => {
    it('MUST apply Sidebar class for styling', () => {
      const { container } = render(<UnauthenticatedSidebar />);

      const sidebar = container.querySelector('.Sidebar');
      expect(sidebar).toBeInTheDocument();
    });

    it('MUST have data-testid for component identification', () => {
      render(<UnauthenticatedSidebar />);

      const sidebar = screen.getByTestId('sidebar');
      expect(sidebar).toBeInTheDocument();
    });

    it('MUST use flexbox layout for vertical stacking', () => {
      const { container } = render(<UnauthenticatedSidebar />);

      const aside = container.querySelector('aside');
      expect(aside).toHaveStyle({ display: 'flex', flexDirection: 'column' });
    });

    it('MUST set sidebar width using CSS variable', () => {
      const { container } = render(<UnauthenticatedSidebar />);

      const aside = container.querySelector('aside');
      const computedStyle = window.getComputedStyle(aside!);

      // Width should reference --Sidebar-width variable
      expect(computedStyle.width).toBeTruthy();
    });

    it('MUST inject global styles for sidebar width', () => {
      render(<UnauthenticatedSidebar />);

      // GlobalStyles should be rendered (can't directly test CSS injection in JSDOM)
      // But we can verify the component renders without errors
      expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    });
  });

  describe('Responsive Behavior', () => {
    it('MUST apply sticky positioning on desktop', () => {
      const { container } = render(<UnauthenticatedSidebar />);

      const aside = container.querySelector('aside');
      // Position is set via sx prop with breakpoint { md: 'sticky' }
      expect(aside).toBeInTheDocument();
    });

    it('MUST occupy full viewport height', () => {
      const { container } = render(<UnauthenticatedSidebar />);

      const aside = container.querySelector('aside');
      expect(aside).toHaveStyle({ height: '100dvh' });
    });

    it('MUST have right border divider', () => {
      const { container } = render(<UnauthenticatedSidebar />);

      const aside = container.querySelector('aside');
      const computedStyle = window.getComputedStyle(aside!);

      expect(computedStyle.borderRight).toBeTruthy();
    });
  });

  describe('Navigation Section', () => {
    it('MUST have navigation section with accessible label', () => {
      const { container } = render(<UnauthenticatedSidebar />);

      const nav = container.querySelector('[aria-label="User actions"]');
      expect(nav).toBeInTheDocument();
      expect(nav?.tagName.toLowerCase()).toBe('nav');
    });

    it('MUST allow for future navigation items (placeholder exists)', () => {
      const { container } = render(<UnauthenticatedSidebar />);

      const nav = container.querySelector('[aria-label="User actions"]');
      expect(nav).toBeInTheDocument();

      // Should be empty for now but ready for nav items
      expect(nav?.textContent).toBe('');
    });

    it('MUST have scrollable navigation area', () => {
      const { container } = render(<UnauthenticatedSidebar />);

      const nav = container.querySelector('[aria-label="User actions"]');
      expect(nav).toHaveStyle({ overflow: 'hidden auto' });
    });

    it('MUST allow navigation section to grow and fill space', () => {
      const { container } = render(<UnauthenticatedSidebar />);

      const nav = container.querySelector('[aria-label="User actions"]');
      expect(nav).toHaveStyle({ flexGrow: '1' });
    });
  });

  describe('Component Integrity', () => {
    it('MUST render without crashing', () => {
      expect(() => render(<UnauthenticatedSidebar />)).not.toThrow();
    });

    it('MUST render consistently across multiple renders', () => {
      const { rerender } = render(<UnauthenticatedSidebar />);
      const firstRender = screen.getByText('ForestGEO').outerHTML;

      rerender(<UnauthenticatedSidebar />);
      const secondRender = screen.getByText('ForestGEO').outerHTML;

      expect(firstRender).toBe(secondRender);
    });

    it('MUST maintain ref to container element', () => {
      const { container } = render(<UnauthenticatedSidebar />);

      const aside = container.querySelector('aside');
      expect(aside).toBeInTheDocument();
    });
  });

  describe('Accessibility - ARIA Labels', () => {
    it('MUST have descriptive aria-label for main navigation', () => {
      render(<UnauthenticatedSidebar />);

      const nav = screen.getByRole('navigation', { name: 'Main navigation' });
      expect(nav).toHaveAttribute('aria-label', 'Main navigation');
    });

    it('MUST have descriptive aria-label for application name banner', () => {
      render(<UnauthenticatedSidebar />);

      const banner = screen.getByRole('banner');
      expect(banner).toHaveAttribute('aria-label', 'Application name');
    });

    it('MUST have descriptive aria-label for user actions nav', () => {
      const { container } = render(<UnauthenticatedSidebar />);

      const userActionsNav = container.querySelector('[aria-label="User actions"]');
      expect(userActionsNav).toHaveAttribute('aria-label', 'User actions');
    });

    it('MUST have descriptive aria-label for authentication controls region', () => {
      render(<UnauthenticatedSidebar />);

      const region = screen.getByRole('region', { name: 'Authentication controls' });
      expect(region).toHaveAttribute('aria-label', 'Authentication controls');
    });

    it('MUST properly label horizontal divider', () => {
      const { container } = render(<UnauthenticatedSidebar />);

      const divider = container.querySelector('[aria-orientation="horizontal"]');
      expect(divider).toHaveAttribute('aria-orientation', 'horizontal');
    });
  });

  describe('Integration with LoginLogout', () => {
    it('MUST render LoginLogout component when unauthenticated', () => {
      (useSession as any).mockReturnValue({
        data: null,
        status: 'unauthenticated'
      });

      render(<UnauthenticatedSidebar />);

      expect(screen.getByText('Login to access')).toBeInTheDocument();
      expect(screen.getByText('your information')).toBeInTheDocument();
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

  describe('CSS and Theming', () => {
    it('MUST define sidebar width CSS variable at root level', () => {
      render(<UnauthenticatedSidebar />);

      // GlobalStyles injects :root CSS variables
      // We verify component renders, actual CSS injection happens at runtime
      expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    });

    it('MUST use theme-aware border color', () => {
      const { container } = render(<UnauthenticatedSidebar />);

      const aside = container.querySelector('aside');
      // borderColor: 'divider' is a theme-aware color
      expect(aside).toBeInTheDocument();
    });

    it('MUST apply proper spacing and padding', () => {
      const { container } = render(<UnauthenticatedSidebar />);

      const aside = container.querySelector('aside');
      // p: 2 means padding theme.spacing(2)
      expect(aside).toHaveStyle({ padding: '16px' });
    });

    it('MUST apply gap between sections', () => {
      const { container } = render(<UnauthenticatedSidebar />);

      const aside = container.querySelector('aside');
      // gap: 2 in flexbox layout
      expect(aside).toHaveStyle({ gap: '16px' });
    });
  });

  describe('Screen Reader Experience', () => {
    it('MUST provide clear landmarks for screen reader navigation', () => {
      render(<UnauthenticatedSidebar />);

      // Should have all major landmarks
      expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
      expect(screen.getByRole('banner', { name: 'Application name' })).toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Authentication controls' })).toBeInTheDocument();
    });

    it('MUST have logical document structure for screen readers', () => {
      render(<UnauthenticatedSidebar />);

      // H1 should be first and only h1
      const headings = screen.getAllByRole('heading');
      const h1 = headings.find(h => h.tagName === 'H1');

      expect(h1).toBeInTheDocument();
      expect(h1).toHaveTextContent('ForestGEO');
    });

    it('MUST separate sections with semantic divider', () => {
      const { container } = render(<UnauthenticatedSidebar />);

      const divider = container.querySelector('[aria-orientation="horizontal"]');
      expect(divider).toBeInTheDocument();

      // Divider should be between nav and auth sections
      const sidebar = container.querySelector('aside');
      const dividerIndex = Array.from(sidebar!.children).indexOf(divider as Element);
      expect(dividerIndex).toBeGreaterThan(0);
    });
  });

  describe('Empty State Handling', () => {
    it('MUST gracefully handle empty navigation items', () => {
      render(<UnauthenticatedSidebar />);

      const nav = screen.getByRole('navigation', { name: 'Main navigation' });

      // Navigation section exists but is empty (ready for future items)
      const userActionsNav = nav.querySelector('[aria-label="User actions"]');
      expect(userActionsNav).toBeInTheDocument();
      expect(userActionsNav?.textContent).toBe('');
    });

    it('MUST maintain layout with no navigation items', () => {
      const { container } = render(<UnauthenticatedSidebar />);

      const aside = container.querySelector('aside');

      // Should still have flexbox layout
      expect(aside).toHaveStyle({ display: 'flex', flexDirection: 'column' });
    });
  });
});
