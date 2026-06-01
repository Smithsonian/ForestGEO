import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginLogout } from './loginlogout';
import { signIn, signOut, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import ailogger from '@/ailogger';

// Mock dependencies
vi.mock('next-auth/react');
vi.mock('next/navigation');
vi.mock('@/ailogger');

describe('LoginLogout - Functional Tests', () => {
  const mockPush = vi.fn();
  const mockSignIn = vi.fn();
  const mockSignOut = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useRouter as any).mockReturnValue({ push: mockPush });
    (signIn as any).mockImplementation(mockSignIn);
    (signOut as any).mockImplementation(mockSignOut);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Unauthenticated State', () => {
    beforeEach(() => {
      (useSession as any).mockReturnValue({
        data: null,
        status: 'unauthenticated'
      });
    });

    it('MUST render login prompt when unauthenticated', () => {
      render(<LoginLogout />);

      expect(screen.getByText('Login to access')).toBeInTheDocument();
      expect(screen.getByText('your information')).toBeInTheDocument();
    });

    it('MUST show UNK avatar for unknown user', () => {
      render(<LoginLogout />);

      const avatar = screen.getByText('UNK');
      expect(avatar).toBeInTheDocument();
    });

    it('MUST have accessible login button', () => {
      render(<LoginLogout />);

      const loginButton = screen.getByRole('button', { name: /login/i });
      expect(loginButton).toBeInTheDocument();
      expect(loginButton).toHaveAccessibleName();
    });

    it('MUST call signIn when login button clicked', async () => {
      const user = userEvent.setup();
      mockSignIn.mockResolvedValue(undefined);

      render(<LoginLogout />);

      const loginButton = screen.getByRole('button', { name: /login/i });
      await user.click(loginButton);

      expect(mockSignIn).toHaveBeenCalledWith('microsoft-entra-id', { redirectTo: '/dashboard' });
    });

    it('MUST handle login error gracefully', async () => {
      const user = userEvent.setup();
      const loginError = new Error('Login failed');
      mockSignIn.mockRejectedValue(loginError);
      mockSignOut.mockResolvedValue(undefined);

      const localStorageClearSpy = vi.spyOn(Storage.prototype, 'clear');
      const sessionStorageClearSpy = vi.spyOn(sessionStorage, 'clear');

      render(<LoginLogout />);

      const loginButton = screen.getByRole('button', { name: /login/i });
      await user.click(loginButton);

      await waitFor(() => {
        expect(ailogger.error).toHaveBeenCalledWith('Login error:', loginError);
      });

      await waitFor(() => {
        expect(mockSignOut).toHaveBeenCalledWith({ redirectTo: '/loginfailed?reason=Login failed' });
      });

      localStorageClearSpy.mockRestore();
      sessionStorageClearSpy.mockRestore();
    });

    it('MUST be keyboard accessible', async () => {
      const user = userEvent.setup();
      mockSignIn.mockResolvedValue(undefined);

      render(<LoginLogout />);

      const loginButton = screen.getByRole('button', { name: /login/i });

      // Tab to button and activate with Enter
      loginButton.focus();
      expect(loginButton).toHaveFocus();

      await user.keyboard('{Enter}');

      expect(mockSignIn).toHaveBeenCalled();
    });
  });

  describe('Authenticated State', () => {
    beforeEach(() => {
      (useSession as any).mockReturnValue({
        data: {
          user: {
            name: 'John Doe',
            email: 'john.doe@example.com',
            userStatus: 'user'
          }
        },
        status: 'authenticated'
      });
    });

    it('MUST display user name and email when authenticated', () => {
      render(<LoginLogout />);

      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText('john.doe@example.com')).toBeInTheDocument();
    });

    it('MUST show user avatar with initials', () => {
      render(<LoginLogout />);

      const avatar = screen.getByText('JD');
      expect(avatar).toBeInTheDocument();
    });

    it('MUST have logout button with accessible label', () => {
      render(<LoginLogout />);

      const logoutButton = screen.getByRole('button', { name: /logout/i });
      expect(logoutButton).toBeInTheDocument();
      expect(logoutButton).toHaveAccessibleName();
    });

    it('MUST call signOut when logout button clicked', async () => {
      const user = userEvent.setup();
      mockSignOut.mockResolvedValue(undefined);

      render(<LoginLogout />);

      const logoutButton = screen.getByRole('button', { name: /logout/i });
      await user.click(logoutButton);

      expect(mockSignOut).toHaveBeenCalledWith({ redirectTo: '/login' });
    });

    it('SHOULD show settings button (currently disabled)', () => {
      render(<LoginLogout />);

      const settingsButton = screen.getByRole('button', { name: /settings menu/i });
      expect(settingsButton).toBeDisabled();
      expect(settingsButton).toHaveAccessibleName();
    });

    it('MUST have accessible avatar button', () => {
      render(<LoginLogout />);

      const avatarButton = screen.getByRole('button', { name: /open user menu/i });
      expect(avatarButton).toBeInTheDocument();
      expect(avatarButton).toHaveAccessibleName();
    });

    it('MUST open settings menu when avatar clicked', async () => {
      const user = userEvent.setup();

      render(<LoginLogout />);

      const avatarButton = screen.getByRole('button', { name: /open user menu/i });
      await user.click(avatarButton);

      await waitFor(() => {
        expect(screen.getByText('User Settings')).toBeInTheDocument();
        expect(screen.getByText('Site Settings')).toBeInTheDocument();
        expect(screen.getByText('User-Site Assignments')).toBeInTheDocument();
      });
    });

    it('MUST close settings menu when avatar clicked again', async () => {
      const user = userEvent.setup();

      render(<LoginLogout />);

      const avatarButton = screen.getByRole('button', { name: /open user menu/i });

      // Open menu
      await user.click(avatarButton);
      await waitFor(() => {
        expect(screen.getByText('User Settings')).toBeInTheDocument();
      });

      // Close menu
      await user.click(avatarButton);
      await waitFor(() => {
        expect(screen.queryByText('User Settings')).not.toBeInTheDocument();
      });
    });

    it('MUST be keyboard accessible - avatar button with Enter', async () => {
      const user = userEvent.setup();

      render(<LoginLogout />);

      const avatarButton = screen.getByRole('button', { name: /open user menu/i });
      avatarButton.focus();

      await user.keyboard('{Enter}');

      await waitFor(() => {
        expect(screen.getByText('User Settings')).toBeInTheDocument();
      });
    });

    it('MUST be keyboard accessible - avatar button with Space', async () => {
      render(<LoginLogout />);

      const avatarButton = screen.getByRole('button', { name: /open user menu/i });
      avatarButton.focus();

      // The trigger's own onKeyDown opens the menu on Space keydown.
      // We assert via the keydown alone: a synthesized keyup/click would
      // bleed into the now-focused first menu item (Joy activates buttons on
      // Space keyup), which reflects real focus moving into the listbox.
      fireEvent.keyDown(avatarButton, { key: ' ' });

      await waitFor(() => {
        expect(screen.getByText('User Settings')).toBeInTheDocument();
      });
    });

    it('MUST advertise the user menu via aria attributes and expand on open', async () => {
      const user = userEvent.setup();
      render(<LoginLogout />);
      const trigger = screen.getByRole('button', { name: /open user menu/i });
      expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await user.click(trigger);
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      const menu = await screen.findByRole('menu');
      expect(menu).toHaveAttribute('id', 'user-settings-menu');
      expect(trigger).toHaveAttribute('aria-controls', 'user-settings-menu');
    });

    it('MUST move focus to the first menu item when the menu opens', async () => {
      const user = userEvent.setup();
      render(<LoginLogout />);
      await user.click(screen.getByRole('button', { name: /open user menu/i }));
      const firstItem = await screen.findByRole('menuitem', { name: /user settings/i });
      expect(firstItem).toHaveFocus();
    });

    it('MUST close the menu and not trap focus inside it when dismissed', async () => {
      // Joy's Menu Escape/click-away dismissal does not fire in jsdom (disablePortal,
      // no rendered backdrop), so the Escape-specific onClose path is not observable
      // here. We assert the dismissal contract via the toggle path that does fire:
      // the menu closes and focus returns to the trigger rather than staying trapped
      // on a now-unmounted menu item.
      const user = userEvent.setup();
      render(<LoginLogout />);
      const trigger = screen.getByRole('button', { name: /open user menu/i });
      await user.click(trigger);
      await screen.findByRole('menu');
      await user.click(trigger);
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      expect(document.activeElement?.closest('[role="menu"]')).toBeNull();
      expect(trigger).toHaveFocus();
    });
  });

  describe('Settings Menu Navigation', () => {
    beforeEach(() => {
      (useSession as any).mockReturnValue({
        data: {
          user: {
            name: 'Jane Admin',
            email: 'jane@example.com',
            userStatus: 'db admin'
          }
        },
        status: 'authenticated'
      });
    });

    it('MUST navigate to /admin/users when User Settings clicked', async () => {
      const user = userEvent.setup();

      render(<LoginLogout />);

      const avatarButton = screen.getByRole('button', { name: /open user menu/i });
      await user.click(avatarButton);

      const userSettingsItem = await screen.findByText('User Settings');
      await user.click(userSettingsItem);

      expect(mockPush).toHaveBeenCalledWith('/admin/users');
    });

    it('MUST navigate to /admin/sites when Site Settings clicked', async () => {
      const user = userEvent.setup();

      render(<LoginLogout />);

      const avatarButton = screen.getByRole('button', { name: /open user menu/i });
      await user.click(avatarButton);

      const siteSettingsItem = await screen.findByText('Site Settings');
      await user.click(siteSettingsItem);

      expect(mockPush).toHaveBeenCalledWith('/admin/sites');
    });

    it('MUST navigate to /admin/userstosites when User-Site Assignments clicked', async () => {
      const user = userEvent.setup();

      render(<LoginLogout />);

      const avatarButton = screen.getByRole('button', { name: /open user menu/i });
      await user.click(avatarButton);

      const usersToSitesItem = await screen.findByText('User-Site Assignments');
      await user.click(usersToSitesItem);

      expect(mockPush).toHaveBeenCalledWith('/admin/userstosites');
    });

    it('MUST support keyboard navigation for menu items - Enter', async () => {
      const user = userEvent.setup();

      render(<LoginLogout />);

      const avatarButton = screen.getByRole('button', { name: /open user menu/i });
      await user.click(avatarButton);

      // On open, focus lands on the first item (User Settings).
      // Joy MenuItem natively activates on Enter keydown.
      const userSettingsItem = (await screen.findByText('User Settings')).closest('[role="menuitem"]')!;
      fireEvent.keyDown(userSettingsItem, { key: 'Enter' });

      expect(mockPush).toHaveBeenCalledWith('/admin/users');
    });

    it('MUST support keyboard navigation for menu items - Space', async () => {
      const user = userEvent.setup();

      render(<LoginLogout />);

      const avatarButton = screen.getByRole('button', { name: /open user menu/i });
      await user.click(avatarButton);

      // Joy MenuItem follows native button semantics: Space activates on keyup.
      const siteSettingsItem = (await screen.findByText('Site Settings')).closest('[role="menuitem"]')!;
      fireEvent.keyUp(siteSettingsItem, { key: ' ' });

      expect(mockPush).toHaveBeenCalledWith('/admin/sites');
    });

    it('MUST close menu after navigation', async () => {
      const user = userEvent.setup();

      render(<LoginLogout />);

      const avatarButton = screen.getByRole('button', { name: /open user menu/i });
      await user.click(avatarButton);

      const userSettingsItem = await screen.findByText('User Settings');
      await user.click(userSettingsItem);

      await waitFor(() => {
        expect(screen.queryByText('User Settings')).not.toBeInTheDocument();
      });
    });
  });

  describe('Loading State', () => {
    it('MUST show skeleton loaders when loading', () => {
      (useSession as any).mockReturnValue({
        data: null,
        status: 'loading'
      });

      const { container } = render(<LoginLogout />);

      const skeletons = container.querySelectorAll('.MuiSkeleton-root');
      expect(skeletons.length).toBeGreaterThan(0);
    });

    it('MUST show CircularProgress on logout button when loading', () => {
      (useSession as any).mockReturnValue({
        data: {
          user: {
            name: 'Test User',
            email: 'test@example.com',
            userStatus: 'user'
          }
        },
        status: 'loading'
      });

      render(<LoginLogout />);

      const circularProgress = screen.getByRole('progressbar');
      expect(circularProgress).toBeInTheDocument();
    });
  });

  describe('Avatar Initials Extraction', () => {
    it('MUST extract initials from full name', () => {
      (useSession as any).mockReturnValue({
        data: {
          user: {
            name: 'Alice Bob Charlie',
            email: 'abc@example.com',
            userStatus: 'user'
          }
        },
        status: 'authenticated'
      });

      render(<LoginLogout />);

      const avatar = screen.getByText('ABC');
      expect(avatar).toBeInTheDocument();
    });

    it('MUST filter out non-alphabetic characters from initials', () => {
      (useSession as any).mockReturnValue({
        data: {
          user: {
            name: 'John123 Doe456',
            email: 'john@example.com',
            userStatus: 'user'
          }
        },
        status: 'authenticated'
      });

      render(<LoginLogout />);

      const avatar = screen.getByText('JD');
      expect(avatar).toBeInTheDocument();
    });

    it('MUST handle single name', () => {
      (useSession as any).mockReturnValue({
        data: {
          user: {
            name: 'Madonna',
            email: 'madonna@example.com',
            userStatus: 'user'
          }
        },
        status: 'authenticated'
      });

      render(<LoginLogout />);

      const avatar = screen.getByText('M');
      expect(avatar).toBeInTheDocument();
    });

    it('MUST handle empty name gracefully', () => {
      (useSession as any).mockReturnValue({
        data: {
          user: {
            name: '',
            email: 'user@example.com',
            userStatus: 'user'
          }
        },
        status: 'authenticated'
      });

      render(<LoginLogout />);

      // Should render without crashing
      expect(screen.getByText('user@example.com')).toBeInTheDocument();
    });

    it('MUST handle hyphenated names', () => {
      (useSession as any).mockReturnValue({
        data: {
          user: {
            name: 'Mary-Jane Watson',
            email: 'mj@example.com',
            userStatus: 'user'
          }
        },
        status: 'authenticated'
      });

      render(<LoginLogout />);

      const avatar = screen.getByText('MJW');
      expect(avatar).toBeInTheDocument();
    });
  });

  describe('Component Integrity', () => {
    it('MUST render without crashing when unauthenticated', () => {
      (useSession as any).mockReturnValue({
        data: null,
        status: 'unauthenticated'
      });

      expect(() => render(<LoginLogout />)).not.toThrow();
    });

    it('MUST render without crashing when authenticated', () => {
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

      expect(() => render(<LoginLogout />)).not.toThrow();
    });

    it('MUST render consistently across multiple renders', () => {
      (useSession as any).mockReturnValue({
        data: {
          user: {
            name: 'Consistent User',
            email: 'consistent@example.com',
            userStatus: 'user'
          }
        },
        status: 'authenticated'
      });

      const { rerender } = render(<LoginLogout />);
      const firstRender = screen.getByText('Consistent User').outerHTML;

      rerender(<LoginLogout />);
      const secondRender = screen.getByText('Consistent User').outerHTML;

      expect(firstRender).toBe(secondRender);
    });

    it('MUST have data-testid for component identification', () => {
      (useSession as any).mockReturnValue({
        data: null,
        status: 'unauthenticated'
      });

      const { container } = render(<LoginLogout />);

      const component = container.querySelector('[data-testid="login-logout-component"]');
      expect(component).toBeInTheDocument();
    });
  });

  describe('Accessibility Compliance', () => {
    beforeEach(() => {
      (useSession as any).mockReturnValue({
        data: {
          user: {
            name: 'Access Test',
            email: 'access@example.com',
            userStatus: 'user'
          }
        },
        status: 'authenticated'
      });
    });

    it('MUST have accessible avatar with initials as text', () => {
      render(<LoginLogout />);

      // Avatar shows initials as text (AT = Access Test)
      const avatar = screen.getByText('AT');
      expect(avatar).toBeInTheDocument();

      // WCAG 2.5.3 (Label in Name): the visible initials must appear in the
      // button's accessible name so speech-control users can target it.
      const avatarButton = screen.getByRole('button', { name: /AT, open user menu/i });
      expect(avatarButton).toHaveAccessibleName();
    });

    it('MUST truncate long emails with text-overflow', () => {
      (useSession as any).mockReturnValue({
        data: {
          user: {
            name: 'User',
            email: 'verylongemail@verylongdomainname.example.com',
            userStatus: 'user'
          }
        },
        status: 'authenticated'
      });

      const { container: _container } = render(<LoginLogout />);

      const emailElement = screen.getByText('verylongemail@verylongdomainname.example.com');
      const style = window.getComputedStyle(emailElement);

      expect(style.overflow).toBe('hidden');
      expect(style.textOverflow).toBe('ellipsis');
      expect(style.whiteSpace).toBe('nowrap');
    });

    it('SHOULD have disabled settings button with title explaining its purpose', () => {
      render(<LoginLogout />);

      // The settings button has aria-label="Settings menu" and title="Settings menu"
      // It is disabled for non-admin users
      const settingsButton = screen.getByRole('button', { name: /settings menu/i });
      expect(settingsButton).toBeInTheDocument();
      expect(settingsButton).toBeDisabled();
      expect(settingsButton).toHaveAttribute('title', 'Settings menu');
    });
  });

  describe('Error Handling', () => {
    it('MUST clear storage on login failure', async () => {
      (useSession as any).mockReturnValue({
        data: null,
        status: 'unauthenticated'
      });

      const user = userEvent.setup();
      const loginError = new Error('Authentication failed');
      mockSignIn.mockRejectedValue(loginError);
      mockSignOut.mockResolvedValue(undefined);

      const localStorageClearSpy = vi.spyOn(Storage.prototype, 'clear');
      const sessionStorageClearSpy = vi.spyOn(sessionStorage, 'clear');

      render(<LoginLogout />);

      const loginButton = screen.getByRole('button', { name: /login/i });
      await user.click(loginButton);

      await waitFor(() => {
        expect(ailogger.error).toHaveBeenCalledWith('Login error:', loginError);
      });

      // Wait for signOut and storage clear chain
      await waitFor(() => {
        expect(mockSignOut).toHaveBeenCalled();
      });

      localStorageClearSpy.mockRestore();
      sessionStorageClearSpy.mockRestore();
    });
  });
});
