// loginPage.test.tsx

import { render, screen } from '@testing-library/react';
import { describe, it, vi, beforeEach, Mock, expect } from 'vitest';
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

describe('LoginPage Component', () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
  });

  it('renders the unauthenticated sidebar if the user is unauthenticated', () => {
    // Mock unauthenticated status
    (useSession as Mock).mockReturnValue({ data: null, status: 'unauthenticated' });

    render(<LoginPage />);

    // Assert that the sidebar is present and visible
    expect(screen.getByTestId('unauthenticated-sidebar')).toBeInTheDocument();
  });

  it('redirects to dashboard if the user is authenticated', () => {
    // Mock authenticated status
    (useSession as Mock).mockReturnValue({ data: { user: {} }, status: 'authenticated' });

    render(<LoginPage />);

    // Assert that redirect was called to navigate to the dashboard
    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });
});
