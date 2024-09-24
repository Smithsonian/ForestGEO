import { render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import DashboardPage from '@/app/(hub)/dashboard/page';
import { useSession } from 'next-auth/react';
import '@testing-library/jest-dom/vitest';
import { LockAnimationProvider } from '@/app/contexts/lockanimationcontext';

// Mock the useSession hook
vi.mock('next-auth/react', () => ({
  useSession: vi.fn()
}));

// Define a mock session object
const mockSession = {
  user: {
    name: 'John Doe',
    email: 'john.doe@example.com',
    userStatus: 'admin',
    sites: [
      { schemaName: 'site1', siteName: 'Site 1' },
      { schemaName: 'site2', siteName: 'Site 2' }
    ]
  }
};

describe.skip('DashboardPage Component', () => {
  // Mock the authenticated session before all tests
  beforeAll(() => {
    (useSession as Mock).mockReturnValue({ data: mockSession, status: 'authenticated' });
  });

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
  });

  const renderWithProvider = () => {
    return render(
      <LockAnimationProvider>
        <DashboardPage />
      </LockAnimationProvider>
    );
  };

  it("displays the user's name", () => {
    renderWithProvider();

    // Assert that the user's name is displayed
    expect(screen.getByText(/Welcome, John Doe!/i)).toBeInTheDocument();
  });

  it("displays the user's email", () => {
    renderWithProvider();

    // Assert that the user's email is displayed
    // To handle multiple instances of "Registered Email:"
    const emails = screen.getAllByText(/Registered Email:/i);
    expect(emails).length.greaterThanOrEqual(1); // Expect only one occurrence or handle all
    expect(emails[0]).toBeInTheDocument();
    expect(screen.getByText(/john.doe@example.com/i)).toBeInTheDocument();
  });

  it("displays the user's permission status", () => {
    renderWithProvider();

    // Same for "Assigned Role:"
    const roles = screen.getAllByText(/Assigned Role:/i);
    expect(roles).length.greaterThanOrEqual(1); // Handle according to your use case
    expect(roles[0]).toBeInTheDocument();

    expect(screen.getByText(/global/i)).toBeInTheDocument();
  });

  it('displays the list of allowed sites', () => {
    renderWithProvider();

    // Assert that the allowed sites are displayed
    const sites = screen.getAllByText(/You have access to the following sites:/i);
    expect(sites).length.greaterThanOrEqual(1); // Handle according to your use case
    expect(sites[0]).toBeInTheDocument();
    expect(screen.getByText(/Site 1/i)).toBeInTheDocument();
    expect(screen.getByText(/Site 2/i)).toBeInTheDocument();
  });
});
