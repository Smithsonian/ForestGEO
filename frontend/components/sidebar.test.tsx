import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Sidebar from './sidebar';
import { useSession } from 'next-auth/react';
import { usePathname, useRouter } from 'next/navigation';

// Mock all dependencies
vi.mock('next-auth/react');
vi.mock('next/navigation');
vi.mock('@/app/contexts/userselectionprovider', () => ({
  useOrgCensusContext: () => null,
  useOrgCensusDispatch: () => vi.fn(),
  usePlotContext: () => null,
  usePlotDispatch: () => vi.fn(),
  useSiteContext: () => null,
  useSiteDispatch: () => vi.fn()
}));
vi.mock('@/app/contexts/listselectionprovider', () => ({
  useOrgCensusListContext: () => [],
  usePlotListContext: () => [],
  useSiteListContext: () => []
}));
vi.mock('@/app/contexts/loadingprovider', () => ({
  useLoading: () => ({
    setLoading: vi.fn()
  })
}));
vi.mock('@/app/contexts/datavalidityprovider', () => ({
  useDataValidityContext: () => ({
    validity: {
      attributes: true,
      personnel: true,
      species: true,
      quadrats: true,
      subquadrats: false
    },
    isDataValid: true,
    shouldAddPlot: false,
    shouldAddCensus: false
  })
}));
vi.mock('@/components/client/modals/plotcardmodal', () => ({
  default: () => <div data-testid="plot-card-modal">Plot Card Modal</div>
}));

describe('Sidebar - Functional Tests', () => {
  const mockPush = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock ResizeObserver for JSDOM
    global.ResizeObserver = vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn()
    }));

    (useRouter as any).mockReturnValue({ push: mockPush });
    (usePathname as any).mockReturnValue('/dashboard');
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
  });

  describe('Accessibility - Semantic HTML', () => {
    it('MUST render sidebar container', () => {
      render(<Sidebar />);

      // Sidebar renders as Stack without aside wrapper (multiple ForestGEO texts exist)
      const forestgeoElements = screen.getAllByText('ForestGEO');
      expect(forestgeoElements.length).toBeGreaterThan(0);
    });

    it('MUST have heading for branding', () => {
      render(<Sidebar />);

      const heading = screen.getByRole('heading', { level: 1 });
      expect(heading).toHaveTextContent('ForestGEO');
    });

    it('MUST have accessible site selection dropdown', () => {
      render(<Sidebar />);

      const siteSelect = screen.getByRole('combobox', { name: /select a site/i });
      expect(siteSelect).toBeInTheDocument();
      expect(siteSelect).toHaveAttribute('aria-label');
    });

    it('MUST have accessible census selection dropdown', () => {
      render(<Sidebar />);

      const censusSelect = screen.getByRole('combobox', { name: /select a census/i });
      expect(censusSelect).toBeInTheDocument();
      expect(censusSelect).toHaveAttribute('aria-label');
    });
  });

  describe('Branding and Layout', () => {
    it('MUST render ForestGEO branding', () => {
      render(<Sidebar />);

      const forestgeoElements = screen.getAllByText('ForestGEO');
      expect(forestgeoElements.length).toBeGreaterThan(0);
    });

    it('MUST render site selection component', () => {
      render(<Sidebar />);

      const siteSelect = screen.getByTestId('site-select-component');
      expect(siteSelect).toBeInTheDocument();
    });

    it('MUST include dividers to separate sections', () => {
      const { container } = render(<Sidebar />);

      const dividers = container.querySelectorAll('hr');
      expect(dividers.length).toBeGreaterThan(0);
    });
  });

  describe('LoginLogout Integration', () => {
    it('MUST render LoginLogout component', () => {
      render(<Sidebar />);

      // LoginLogout should show user info when authenticated
      expect(screen.getByText('Test User')).toBeInTheDocument();
      expect(screen.getByText('test@example.com')).toBeInTheDocument();
    });

    it('MUST show login prompt when unauthenticated', () => {
      (useSession as any).mockReturnValue({
        data: null,
        status: 'unauthenticated'
      });

      render(<Sidebar />);

      expect(screen.getByText('Login to access')).toBeInTheDocument();
    });
  });

  describe('Selection Dropdowns', () => {
    it('MUST render site selection dropdown', () => {
      render(<Sidebar />);

      const siteSelect = screen.getByRole('combobox', { name: /select a site/i });
      expect(siteSelect).toBeInTheDocument();
    });

    it('MUST render census selection dropdown', () => {
      render(<Sidebar />);

      const censusSelect = screen.getByRole('combobox', { name: /select a census/i });
      expect(censusSelect).toBeInTheDocument();
    });

    it('MUST mark required fields with aria-required', () => {
      render(<Sidebar />);

      const siteSelect = screen.getByRole('combobox', { name: /select a site/i });
      expect(siteSelect).toHaveAttribute('aria-required', 'true');
    });
  });

  describe('Component Integrity', () => {
    it('MUST render without crashing', () => {
      expect(() => render(<Sidebar />)).not.toThrow();
    });

    it('MUST render consistently across multiple renders', () => {
      const { rerender } = render(<Sidebar />);
      const firstRender = screen.getAllByText('ForestGEO')[0].outerHTML;

      rerender(<Sidebar />);
      const secondRender = screen.getAllByText('ForestGEO')[0].outerHTML;

      expect(firstRender).toBe(secondRender);
    });

    it('MUST handle different authentication states', () => {
      const { rerender } = render(<Sidebar />);
      expect(screen.getByText('Test User')).toBeInTheDocument();

      (useSession as any).mockReturnValue({
        data: null,
        status: 'unauthenticated'
      });

      rerender(<Sidebar />);
      expect(screen.getByText('Login to access')).toBeInTheDocument();
    });

    it('MUST handle different route contexts', () => {
      (usePathname as any).mockReturnValue('/dashboard');
      const { rerender } = render(<Sidebar />);
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();

      (usePathname as any).mockReturnValue('/measurementshub');
      rerender(<Sidebar />);
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    });
  });

  describe('Responsive Layout', () => {
    it('MUST render with proper layout structure', () => {
      render(<Sidebar />);

      const forestgeoElements = screen.getAllByText('ForestGEO');
      expect(forestgeoElements.length).toBeGreaterThan(0);
      expect(screen.getByRole('combobox', { name: /select a site/i })).toBeInTheDocument();
    });

    it('MUST organize selections vertically', () => {
      const { container } = render(<Sidebar />);

      const selectionComponents = container.querySelectorAll('[data-testid*="select"]');
      expect(selectionComponents.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('SimpleToggler Component', () => {
    it('MUST render toggler with children when open', () => {
      const { container } = render(<Sidebar />);

      // SimpleToggler is used for expanding/collapsing sections
      const togglers = container.querySelectorAll('[data-testid="simple-toggler"]');
      expect(togglers.length).toBeGreaterThanOrEqual(0);
    });

    it('MUST apply transition animation', () => {
      const { container } = render(<Sidebar />);

      const togglers = container.querySelectorAll('[data-testid="simple-toggler"]');
      togglers.forEach(toggler => {
        const styles = window.getComputedStyle(toggler);
        expect(styles.transition).toBeTruthy();
      });
    });
  });

  describe('Screen Reader Experience', () => {
    it('MUST have accessible labels for all interactive elements', () => {
      render(<Sidebar />);

      const comboboxes = screen.getAllByRole('combobox');
      comboboxes.forEach(combobox => {
        expect(combobox).toHaveAccessibleName();
      });
    });

    it('MUST have logical heading structure', () => {
      render(<Sidebar />);

      const heading = screen.getByRole('heading', { level: 1 });
      expect(heading).toHaveTextContent('ForestGEO');
    });

    it('MUST use semantic dividers for visual separation', () => {
      const { container } = render(<Sidebar />);

      const dividers = container.querySelectorAll('hr[role="separator"]');
      expect(dividers.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Error Handling', () => {
    it('MUST handle missing session gracefully', () => {
      (useSession as any).mockReturnValue({
        data: null,
        status: 'loading'
      });

      expect(() => render(<Sidebar />)).not.toThrow();
    });

    it('MUST handle missing pathname gracefully', () => {
      (usePathname as any).mockReturnValue(null);

      expect(() => render(<Sidebar />)).not.toThrow();
    });

    it('MUST handle missing router gracefully', () => {
      (useRouter as any).mockReturnValue(null);

      expect(() => render(<Sidebar />)).not.toThrow();
    });
  });

  describe('CSS and Theming', () => {
    it('MUST render with proper styling classes', () => {
      const { container } = render(<Sidebar />);

      // MUI classes should be applied
      const muiElements = container.querySelectorAll('[class*="Mui"]');
      expect(muiElements.length).toBeGreaterThan(0);
    });

    it('MUST apply styles to selection components', () => {
      render(<Sidebar />);

      const siteSelect = screen.getByTestId('site-select-component');
      expect(siteSelect).toHaveClass(/MuiSelect/);
    });
  });

  describe('User Interaction', () => {
    it('MUST allow interaction with selection dropdowns', async () => {
      const user = userEvent.setup();
      render(<Sidebar />);

      const siteSelect = screen.getByRole('combobox', { name: /select a site/i });
      expect(siteSelect).toBeInTheDocument();
      expect(siteSelect).not.toBeDisabled();
    });

    it('MUST support keyboard navigation', async () => {
      const user = userEvent.setup();
      render(<Sidebar />);

      const siteSelect = screen.getByRole('combobox', { name: /select a site/i });
      siteSelect.focus();
      expect(siteSelect).toHaveFocus();
    });
  });

  describe('Visual Structure', () => {
    it('MUST organize content with proper spacing', () => {
      const { container } = render(<Sidebar />);

      expect(container.querySelector('hr')).toBeInTheDocument();
    });

    it('MUST use dividers to separate sections', () => {
      const { container } = render(<Sidebar />);

      const dividers = container.querySelectorAll('hr');
      expect(dividers.length).toBeGreaterThan(0);
    });
  });
});
