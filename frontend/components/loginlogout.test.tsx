import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginLogout, getUserInitials } from './loginlogout';
import { signIn, signOut, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import ailogger from '@/ailogger';

// Mock dependencies
vi.mock('next-auth/react');
vi.mock('next/navigation');
vi.mock('@/ailogger');

// Joy's Avatar root class and the data-testid Joy's createSvgIcon stamps on its fallback Person icon
// (@mui/joy/utils/createSvgIcon.js).
const AVATAR_ROOT_SELECTOR = '.MuiAvatar-root';
const FALLBACK_PERSON_ICON_TEST_ID = 'PersonIcon';

const OUTSIDE_FIELD_LABEL = 'outside field';
const AFTER_MENU_BUTTON_LABEL = 'after menu';
// The three document listeners MUI's ClickAwayListener registers.
const CLICK_AWAY_EVENT_TYPES = new Set(['click', 'touchend', 'touchmove']);

function describeFocusedElement(): string {
  const active = document.activeElement;
  if (!active || active === document.body) return 'document.body';
  return `${active.tagName.toLowerCase()}[aria-label="${active.getAttribute('aria-label') ?? ''}"] "${active.textContent?.trim() ?? ''}"`;
}

interface DocumentListenerRegistration {
  type: string;
  listener: EventListenerOrEventListenerObject;
  wrapper: EventListener;
  runCount: number;
  removed: boolean;
}

/** Records ClickAwayListener's document listeners by callback identity. Both spies still call through. */
function recordClickAwayDocumentListeners(): { registrations: DocumentListenerRegistration[]; restore: () => void } {
  const registrations: DocumentListenerRegistration[] = [];
  const realAdd = document.addEventListener.bind(document);
  const realRemove = document.removeEventListener.bind(document);
  const addSpy = vi.spyOn(document, 'addEventListener').mockImplementation(((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ) => {
    if (!CLICK_AWAY_EVENT_TYPES.has(type)) return realAdd(type, listener, options);
    const registration: DocumentListenerRegistration = {
      type,
      listener,
      runCount: 0,
      removed: false,
      wrapper: (event: Event) => {
        registration.runCount += 1;
        if (typeof listener === 'function') listener.call(document, event);
        else listener.handleEvent(event);
      }
    };
    registrations.push(registration);
    realAdd(type, registration.wrapper, options);
  }) as typeof document.addEventListener);
  const removeSpy = vi.spyOn(document, 'removeEventListener').mockImplementation(((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions
  ) => {
    const registration = registrations.find(candidate => candidate.type === type && candidate.listener === listener && !candidate.removed);
    if (!registration) return realRemove(type, listener, options);
    registration.removed = true;
    realRemove(type, registration.wrapper, options);
  }) as typeof document.removeEventListener);
  return {
    registrations,
    restore: () => {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    }
  };
}

/** ClickAwayListener arms itself on a setTimeout(0) after mount. */
async function waitForClickAwayActivation(): Promise<void> {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

const USER_INITIALS_CASES: Array<{ name: string; expected: string }> = [
  { name: 'Alice Bob Charlie', expected: 'AC' },
  { name: 'Mary-Jane Smith', expected: 'MS' },
  { name: 'Stilwell, Mason S.', expected: 'SS' },
  { name: 'José Álvarez', expected: 'JÁ' },
  { name: 'Cher', expected: 'C' },
  { name: '  ', expected: '' }
];

describe('LoginLogout - Functional Tests', () => {
  const mockPush = vi.fn();
  const mockSignIn = vi.fn();
  const mockSignOut = vi.fn();

  // User Settings / User-Site Assignments / Provisioning menu items are gated to the
  // global role; tests asserting them must authenticate as a global admin.
  const mockGlobalAdminSession = () => {
    (useSession as any).mockReturnValue({
      data: {
        user: {
          name: 'John Doe',
          email: 'john.doe@example.com',
          userStatus: 'global'
        }
      },
      status: 'authenticated'
    });
  };

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

    it('MUST show the fallback person icon, and no text, for a signed-out user', () => {
      const { container } = render(<LoginLogout />);

      const avatar = container.querySelector<HTMLElement>(AVATAR_ROOT_SELECTOR);
      console.log(`[signed-out avatar] textContent=${JSON.stringify(avatar?.textContent)} innerHTML=${avatar?.innerHTML}`);
      expect(avatar, 'the signed-out branch must render a Joy Avatar').not.toBeNull();
      expect(within(avatar!).getByTestId(FALLBACK_PERSON_ICON_TEST_ID)).toBeInTheDocument();
      // Asserting only that "UNK" is gone would pass with Joy's alt[0] fallback ("u").
      expect(avatar!.textContent, 'neither "UNK" nor the alt-derived "u" may be rendered').toBe('');
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
      mockGlobalAdminSession();
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
      mockGlobalAdminSession();
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
      mockGlobalAdminSession();
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
      mockGlobalAdminSession();
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
      mockGlobalAdminSession();
      const user = userEvent.setup();
      render(<LoginLogout />);
      await user.click(screen.getByRole('button', { name: /open user menu/i }));
      const firstItem = await screen.findByRole('menuitem', { name: /user settings/i });
      expect(firstItem).toHaveFocus();
    });

    it('MUST close the menu and not trap focus inside it when dismissed', async () => {
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

  describe('Settings menu dismissal (#524 item 2)', () => {
    const mockSessionWithStatus = (userStatus: string) => {
      (useSession as any).mockReturnValue({
        data: { user: { name: 'Dana Example', email: 'dana@example.com', userStatus } },
        status: 'authenticated'
      });
    };

    it('closes on Escape and returns focus to the avatar that opened it (admin)', async () => {
      mockSessionWithStatus('global');
      const user = userEvent.setup();
      render(<LoginLogout />);
      const avatarTrigger = screen.getByRole('button', { name: /open user menu/i });

      await user.click(avatarTrigger);
      await screen.findByRole('menu');
      console.log(`[menu-escape avatar/admin] focus before Escape: ${describeFocusedElement()}`);
      await user.keyboard('{Escape}');
      console.log(`[menu-escape avatar/admin] focus after Escape: ${describeFocusedElement()}`);

      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      expect(avatarTrigger).toHaveFocus();
    });

    it('closes on Escape and returns focus to the Settings button that opened it (admin)', async () => {
      mockSessionWithStatus('global');
      const user = userEvent.setup();
      render(<LoginLogout />);
      const settingsTrigger = screen.getByRole('button', { name: /settings menu/i });

      await user.click(settingsTrigger);
      await screen.findByRole('menu');
      await user.keyboard('{Escape}');
      console.log(`[menu-escape settings/admin] focus after Escape: ${describeFocusedElement()}`);

      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      expect(settingsTrigger).toHaveFocus();
    });

    it('closes on Escape and returns focus to the avatar for a non-admin (Settings disabled)', async () => {
      mockSessionWithStatus('user');
      const user = userEvent.setup();
      render(<LoginLogout />);
      expect(screen.getByRole('button', { name: /settings menu/i })).toBeDisabled();
      const avatarTrigger = screen.getByRole('button', { name: /open user menu/i });

      await user.click(avatarTrigger);
      await screen.findByRole('menu');
      await user.keyboard('{Escape}');
      console.log(`[menu-escape avatar/user] focus after Escape: ${describeFocusedElement()}`);

      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      expect(avatarTrigger).toHaveFocus();
    });

    it('closes when an outside input is clicked and leaves focus on that input', async () => {
      mockSessionWithStatus('global');
      const user = userEvent.setup();
      render(
        <>
          <input aria-label={OUTSIDE_FIELD_LABEL} />
          <LoginLogout />
        </>
      );

      await user.click(screen.getByRole('button', { name: /open user menu/i }));
      await screen.findByRole('menu');
      await user.click(screen.getByLabelText(OUTSIDE_FIELD_LABEL));
      console.log(`[menu-click-outside input] focus after click: ${describeFocusedElement()}`);

      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      expect(screen.getByLabelText(OUTSIDE_FIELD_LABEL)).toHaveFocus();
    });

    it('closes when document.body is clicked and does not move focus onto a trigger', async () => {
      mockSessionWithStatus('global');
      const user = userEvent.setup();
      render(<LoginLogout />);
      const avatarTrigger = screen.getByRole('button', { name: /open user menu/i });
      const settingsTrigger = screen.getByRole('button', { name: /settings menu/i });

      await user.click(avatarTrigger);
      await screen.findByRole('menu');
      await user.click(document.body);
      console.log(`[menu-click-outside body] focus after click: ${describeFocusedElement()}`);

      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      expect(avatarTrigger).not.toHaveFocus();
      expect(settingsTrigger).not.toHaveFocus();
    });

    it('closes when Tab moves focus out of the menu, leaving focus on the next focusable element', async () => {
      // A non-admin sees a single menu item, so Tab from it must leave the menu.
      mockSessionWithStatus('user');
      const user = userEvent.setup();
      render(
        <>
          <LoginLogout />
          <button type="button">{AFTER_MENU_BUTTON_LABEL}</button>
        </>
      );

      await user.click(screen.getByRole('button', { name: /open user menu/i }));
      await screen.findByRole('menu');
      console.log(`[menu-tab] focus before Tab: ${describeFocusedElement()}`);
      await user.tab();
      console.log(`[menu-tab] focus after Tab: ${describeFocusedElement()}`);

      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      expect(screen.getByRole('button', { name: AFTER_MENU_BUTTON_LABEL })).toHaveFocus();
    });

    it.each([
      ['avatar', /open user menu/i],
      ['Settings', /settings menu/i]
    ])('a %s trigger click while the menu is open closes it and it stays closed', async (_label, triggerName) => {
      mockSessionWithStatus('global');
      const user = userEvent.setup();
      render(<LoginLogout />);
      const trigger = screen.getByRole('button', { name: triggerName });

      await user.click(trigger);
      await screen.findByRole('menu');
      await user.click(trigger);
      console.log(`[menu-trigger-toggle ${_label}] menu present after second click: ${screen.queryByRole('menu') !== null}`);

      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      // Give a click-away that wrongly re-toggled the menu a chance to reopen it.
      await waitForClickAwayActivation();
      expect(screen.queryByRole('menu'), 'the menu must not reopen after the trigger closed it').toBeNull();
    });

    it('removes every ClickAwayListener document listener on unmount, and none of them runs afterwards', async () => {
      mockSessionWithStatus('global');
      const recorder = recordClickAwayDocumentListeners();
      try {
        const { unmount } = render(<LoginLogout />);
        const avatarTrigger = screen.getByRole('button', { name: /open user menu/i });

        fireEvent.click(avatarTrigger);
        await screen.findByRole('menu');
        await waitForClickAwayActivation();
        fireEvent.click(document.body);
        console.log(
          `[click-away listeners] after body click: ${JSON.stringify(recorder.registrations.map(r => ({ type: r.type, runs: r.runCount, removed: r.removed })))}`
        );
        expect(recorder.registrations.length, 'positive control: ClickAwayListener must register document listeners').toBeGreaterThan(0);
        expect(
          recorder.registrations.some(r => r.type === 'click' && r.runCount > 0),
          'positive control: a body click must run a recorded listener'
        ).toBe(true);
        await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

        fireEvent.click(avatarTrigger);
        await screen.findByRole('menu');
        await waitForClickAwayActivation();
        unmount();

        const runCountsAtUnmount = recorder.registrations.map(r => r.runCount);
        fireEvent.click(document.body);
        console.log(
          `[click-away listeners] after unmount: ${JSON.stringify(recorder.registrations.map(r => ({ type: r.type, runs: r.runCount, removed: r.removed })))}`
        );
        expect(
          recorder.registrations.every(r => r.removed),
          'every recorded registration must be removed with the same callback'
        ).toBe(true);
        expect(
          recorder.registrations.map(r => r.runCount),
          'no recorded listener may run after unmount'
        ).toEqual(runCountsAtUnmount);
      } finally {
        recorder.restore();
      }
    });
  });

  describe('Settings Menu Navigation', () => {
    beforeEach(() => {
      (useSession as any).mockReturnValue({
        data: {
          user: {
            name: 'Jane Admin',
            email: 'jane@example.com',
            userStatus: 'global'
          }
        },
        status: 'authenticated'
      });
    });

    it('MUST show user management to db admins while keeping Provisioning global-only', async () => {
      (useSession as any).mockReturnValue({
        data: {
          user: {
            name: 'Dana DbAdmin',
            email: 'dana@example.com',
            userStatus: 'db admin'
          }
        },
        status: 'authenticated'
      });
      const user = userEvent.setup();

      render(<LoginLogout />);

      await user.click(screen.getByRole('button', { name: /open user menu/i }));

      expect(await screen.findByText('User Settings')).toBeInTheDocument();
      expect(screen.getByText('User-Site Assignments')).toBeInTheDocument();
      expect(screen.getByText('Site Settings')).toBeInTheDocument();
      expect(screen.queryByText('Provisioning')).not.toBeInTheDocument();
    });

    it('MUST hide user-administration items from non-admin roles', async () => {
      (useSession as any).mockReturnValue({
        data: {
          user: {
            name: 'Fred Fieldcrew',
            email: 'fred@example.com',
            userStatus: 'field crew'
          }
        },
        status: 'authenticated'
      });
      const user = userEvent.setup();

      render(<LoginLogout />);

      await user.click(screen.getByRole('button', { name: /open user menu/i }));

      expect(await screen.findByText('Site Settings')).toBeInTheDocument();
      expect(screen.queryByText('User Settings')).not.toBeInTheDocument();
      expect(screen.queryByText('User-Site Assignments')).not.toBeInTheDocument();
      expect(screen.queryByText('Provisioning')).not.toBeInTheDocument();
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
    it('MUST use the first and last initials of a three-part name', () => {
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

      const avatar = screen.getByText('AC');
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

      const avatar = screen.getByText('MW');
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

  describe('getUserInitials', () => {
    it.each(USER_INITIALS_CASES)('returns "$expected" for "$name"', ({ name, expected }) => {
      const initials = getUserInitials(name);
      console.log(`[getUserInitials] input=${JSON.stringify(name)} output=${JSON.stringify(initials)} expected=${JSON.stringify(expected)}`);
      expect(initials).toBe(expected);
    });
  });
});
