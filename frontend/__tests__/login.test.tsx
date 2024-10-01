import { render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import LoginPage from '@/app/(login)/login/page';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import '@testing-library/jest-dom/vitest';

// Mock the useSession hook and next/navigation functions
vi.mock('next-auth/react', () => ({
  useSession: vi.fn()
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn()
}));

// Mock the UnauthenticatedSidebar component
vi.mock('@/components/unauthenticatedsidebar', () => ({
  default: () => <div data-testid="unauthenticated-sidebar">Unauthenticated Sidebar</div>
}));

// Define a mock session object to use across tests
const mockSession = {
  user: {
    email: 'user@example.com',
    userStatus: 'admin',
    sites: [{ name: 'Site 1' }, { name: 'Site 2' }],
    allsites: [{ name: 'Site 1' }, { name: 'Site 2' }]
  }
};

describe('LoginPage Component with authenticated session', () => {
  // Set up the mock authenticated session once for all tests
  beforeAll(() => {
    (useSession as Mock).mockReturnValue({ data: mockSession, status: 'authenticated' });
  });

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
  });

  it('redirects to dashboard when the user is authenticated', () => {
    render(<LoginPage />);

    // Assert that redirect was called to navigate to the dashboard
    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });

  // Add more tests here that assume the user is authenticated
  it('does not render the unauthenticated sidebar when the user is authenticated', () => {
    render(<LoginPage />);

    // Assert that the unauthenticated sidebar is not present
    expect(screen.queryByTestId('unauthenticated-sidebar')).not.toBeInTheDocument();
  });

  // Additional tests can go here, all assuming the user is already logged in...
});
