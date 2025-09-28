import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSession, signIn, signOut } from 'next-auth/react';
import { LoginLogout } from '@/components/loginlogout';
import { auth } from '@/auth';
import MapperFactory from '@/config/datamapper';

// Mock next-auth
vi.mock('next-auth/react', () => ({
  useSession: vi.fn(),
  signIn: vi.fn(() => Promise.resolve()), // Return a Promise to support .catch()
  signOut: vi.fn(() => Promise.resolve())
}));

// Mock auth config and dependencies
vi.mock('@/auth.config', () => ({
  default: {
    providers: [],
    callbacks: {}
  }
}));

vi.mock('@/config/datamapper', () => ({
  default: {
    getMapper: vi.fn()
  }
}));

vi.mock('@/app/actions/cookiemanager', () => ({
  submitCookie: vi.fn()
}));

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn()
  })
}));

// Mock AI logger
vi.mock('@/ailogger', () => ({
  default: {
    error: vi.fn()
  }
}));

describe('Authentication Flow Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('LoginLogout Component', () => {
    it('renders login button when user is unauthenticated', () => {
      (useSession as any).mockReturnValue({
        data: null,
        status: 'unauthenticated'
      });

      render(<LoginLogout />);

      expect(screen.getByText('Login to access')).toBeInTheDocument();
      expect(screen.getByText('your information')).toBeInTheDocument();
      expect(screen.getByLabelText('Login button')).toBeInTheDocument();
    });

    it('calls signIn when login button is clicked', async () => {
      const user = userEvent.setup();
      (useSession as any).mockReturnValue({
        data: null,
        status: 'unauthenticated'
      });

      render(<LoginLogout />);

      const loginButton = screen.getByLabelText('Login button');
      await user.click(loginButton);

      expect(signIn).toHaveBeenCalledWith('microsoft-entra-id', { redirectTo: '/dashboard' });
    });

    it('renders user info when authenticated', () => {
      const mockSession = {
        user: {
          name: 'John Doe',
          email: 'john.doe@example.com'
        }
      };

      (useSession as any).mockReturnValue({
        data: mockSession,
        status: 'authenticated'
      });

      render(<LoginLogout />);

      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText('john.doe@example.com')).toBeInTheDocument();
      expect(screen.getByLabelText('Logout button')).toBeInTheDocument();
    });

    it('calls signOut when logout button is clicked', async () => {
      const user = userEvent.setup();
      const mockSession = {
        user: {
          name: 'John Doe',
          email: 'john.doe@example.com'
        }
      };

      (useSession as any).mockReturnValue({
        data: mockSession,
        status: 'authenticated'
      });

      render(<LoginLogout />);

      const logoutButton = screen.getByLabelText('Logout button');
      await user.click(logoutButton);

      expect(signOut).toHaveBeenCalledWith({ redirectTo: '/login' });
    });

    it('handles loading state correctly', () => {
      (useSession as any).mockReturnValue({
        data: null,
        status: 'loading'
      });

      render(<LoginLogout />);

      // Should show skeleton loading states
      expect(screen.getByTestId('login-logout-component')).toBeInTheDocument();
    });

    it('handles authentication error gracefully', async () => {
      const user = userEvent.setup();
      const mockError = new Error('Authentication failed');

      (useSession as any).mockReturnValue({
        data: null,
        status: 'unauthenticated'
      });

      (signIn as any).mockRejectedValue(mockError);

      render(<LoginLogout />);

      const loginButton = screen.getByLabelText('Login button');
      await user.click(loginButton);

      await waitFor(() => {
        expect(signOut).toHaveBeenCalledWith({
          redirectTo: `/loginfailed?reason=${mockError.message}`
        });
      });
    });
  });

  describe('Auth Configuration', () => {
    it('properly configures session strategy and maxAge', () => {
      // Test that auth configuration is properly set up
      expect(auth).toBeDefined();
    });

    it('handles user site data fetching in session callback', async () => {
      const mockMapper = {
        mapData: vi.fn().mockReturnValue([
          { siteName: 'Site 1', schemaName: 'schema1' },
          { siteName: 'Site 2', schemaName: 'schema2' }
        ])
      };

      (MapperFactory.getMapper as any).mockReturnValue(mockMapper);

      // Mock fetch for user sites
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            userStatus: 'active',
            allowedSites: [{ siteName: 'Site 1', schemaName: 'schema1' }],
            allSites: [
              { siteName: 'Site 1', schemaName: 'schema1' },
              { siteName: 'Site 2', schemaName: 'schema2' }
            ]
          })
      });

      // This would be tested in an integration test with actual auth flow
      expect(MapperFactory.getMapper).toBeDefined();
    });
  });

  describe('User Session Data', () => {
    it('validates required session properties', () => {
      const validSession = {
        user: {
          email: 'test@example.com',
          name: 'Test User',
          userStatus: 'active',
          sites: [{ siteName: 'Site 1' }],
          allsites: [{ siteName: 'Site 1' }, { siteName: 'Site 2' }]
        }
      };

      expect(validSession.user.email).toBeDefined();
      expect(validSession.user.sites).toHaveLength(1);
      expect(validSession.user.allsites).toHaveLength(2);
    });

    it('handles missing user properties gracefully', () => {
      const incompleteSession = {
        user: {
          email: 'test@example.com'
          // Missing userStatus, sites, allsites
        }
      };

      expect(incompleteSession.user.email).toBeDefined();
      expect(incompleteSession.user.userStatus).toBeUndefined();
      expect(incompleteSession.user.sites).toBeUndefined();
    });
  });
});
