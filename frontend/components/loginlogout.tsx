// loginlogout.tsx
'use client';
import React, { useEffect, useRef, useState } from 'react';
import Avatar from '@mui/joy/Avatar';
import Box from '@mui/joy/Box';
import Typography from '@mui/joy/Typography';
import IconButton from '@mui/joy/IconButton';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import LoginRoundedIcon from '@mui/icons-material/LoginRounded';
import CircularProgress from '@mui/joy/CircularProgress';
import { Button, Menu, MenuItem, Skeleton } from '@mui/joy';
import { signIn, signOut, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { AddCircleOutline, GroupAdd, ManageAccountsRounded, Public, Settings } from '@mui/icons-material';
import ailogger from '@/ailogger';
import { useAppStore } from '@/config/store/appstore';

const LAST_USER_STORAGE_KEY = 'forestgeo-last-user';

export const LoginLogout = () => {
  const { data: session, status } = useSession();
  const [anchorSettings, setAnchorSettings] = useState<HTMLElement | null>(null);
  const router = useRouter();
  // Joy Menu types its ref as HTMLDivElement even though it forwards to the listbox <ul>;
  // we only need querySelector on it, so match the declared type to compile cleanly.
  const menuRef = useRef<HTMLDivElement | null>(null);
  const avatarButtonRef = useRef<HTMLButtonElement | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuId = 'user-settings-menu';
  const isMenuOpen = Boolean(anchorSettings);

  useEffect(() => {
    if (isMenuOpen) {
      const firstItem = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
      firstItem?.focus();
    }
  }, [isMenuOpen]);

  useEffect(() => {
    const email = session?.user?.email;
    if (status !== 'authenticated' || !email) return;

    if (typeof localStorage.getItem !== 'function' || typeof localStorage.setItem !== 'function') return;
    const previousEmail = localStorage.getItem(LAST_USER_STORAGE_KEY);
    if (previousEmail && previousEmail !== email) {
      useAppStore.getState().clearSelections();
      sessionStorage.clear();
    }
    localStorage.setItem(LAST_USER_STORAGE_KEY, email);
  }, [session?.user?.email, status]);

  const closeMenu = () => {
    // anchorSettings holds the trigger DOM node (set from event.currentTarget); it stays
    // mounted when only the menu portal closes, so capture it before clearing state and
    // refocus it to restore focus to the opener on Escape / click-away.
    const trigger = anchorSettings;
    setAnchorSettings(null);
    trigger?.focus();
  };

  const userName = session?.user?.name;
  const userInitials =
    typeof userName === 'string'
      ? (userName
          .replace(/[^a-zA-Z- ]/g, '')
          .match(/\b\w/g)
          ?.join('') ?? '')
      : '';

  const handleRetryLogin = () => {
    signIn('microsoft-entra-id', { redirectTo: '/dashboard' }).catch((error: any) => {
      ailogger.error('Login error:', error);
      signOut({ redirectTo: `/loginfailed?reason=${error.message}` })
        .then(() => {
          if (typeof localStorage.clear === 'function') localStorage.clear();
        })
        .then(() => {
          if (typeof sessionStorage.clear === 'function') sessionStorage.clear();
        });
    });
  };

  const handleLogout = async () => {
    useAppStore.getState().clearSelections();
    if (typeof localStorage.removeItem === 'function') localStorage.removeItem(LAST_USER_STORAGE_KEY);
    if (typeof sessionStorage.clear === 'function') sessionStorage.clear();
    await signOut({ redirectTo: '/login' });
  };

  const roleLabel =
    session?.user?.userStatus === 'global'
      ? 'Administration'
      : session?.user?.userStatus === 'db admin'
        ? 'Database administration'
        : session?.user?.userStatus
          ? session.user.userStatus.replace(/\b\w/g, character => character.toUpperCase())
          : '';

  if (status == 'unauthenticated') {
    return (
      <Box sx={{ display: 'flex', width: '100%' }} data-testid={'login-logout-component'}>
        <Box sx={{ width: '100%' }}>
          <Avatar variant="outlined" size="sm" alt="unknown user (unauthenticated)">
            UNK
          </Avatar>
          <Typography level="title-sm">Login to access</Typography>
          <Typography level="body-xs" sx={{ mb: 1 }}>
            your information
          </Typography>
          <Button fullWidth aria-label="Login button" size="lg" variant="solid" startDecorator={<LoginRoundedIcon />} onClick={handleRetryLogin}>
            Sign in with your Smithsonian account
          </Button>
        </Box>
      </Box>
    );
  } else {
    return (
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }} data-testid={'login-logout-component'}>
        <IconButton
          ref={avatarButtonRef}
          aria-label={userInitials ? `${userInitials}, open user menu` : 'Open user menu'}
          aria-haspopup="menu"
          aria-expanded={isMenuOpen && anchorSettings === avatarButtonRef.current}
          aria-controls={isMenuOpen && anchorSettings === avatarButtonRef.current ? menuId : undefined}
          onClick={event => setAnchorSettings(anchorSettings ? null : event.currentTarget)}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setAnchorSettings(anchorSettings ? null : event.currentTarget);
            }
          }}
          size="sm"
        >
          {roleLabel && (
            <Typography level="body-xs" sx={{ px: 1, color: 'neutral.500', fontWeight: 600 }}>
              {roleLabel}
            </Typography>
          )}
          <Avatar variant="outlined" size="sm" src="" alt={`Avatar for ${userName || 'current user'}`}>
            <Skeleton loading={status == 'loading'}>{userInitials}</Skeleton>
          </Avatar>
        </IconButton>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography level="title-sm">
            <Skeleton loading={status == 'loading'}>{session?.user?.name ? session.user.name : ''}</Skeleton>
          </Typography>
          <Typography
            level="body-xs"
            sx={{
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            <Skeleton loading={status == 'loading'}>{session?.user?.email ? session?.user?.email : ''}</Skeleton>
          </Typography>
        </Box>
        <IconButton
          ref={settingsButtonRef}
          disabled={!['global', 'db admin'].includes(session?.user?.userStatus ?? '')}
          onClick={event => setAnchorSettings(anchorSettings ? null : event.currentTarget)}
          aria-label="Settings menu"
          aria-haspopup="menu"
          aria-expanded={isMenuOpen && anchorSettings === settingsButtonRef.current}
          aria-controls={isMenuOpen && anchorSettings === settingsButtonRef.current ? menuId : undefined}
          title="Settings menu"
          size="sm"
        >
          <Skeleton loading={status == 'loading'}>
            <Settings />
          </Skeleton>
        </IconButton>
        <IconButton size="sm" variant="plain" color="neutral" onClick={() => void handleLogout()} aria-label={'Logout button'}>
          {status == 'loading' ? <CircularProgress size={'lg'} aria-label="Loading user session" /> : <LogoutRoundedIcon />}
        </IconButton>
        <Menu
          ref={menuRef}
          id={menuId}
          anchorEl={anchorSettings}
          open={isMenuOpen}
          onClose={closeMenu}
          placement={'top-end'}
          disablePortal
          sx={{ zIndex: 1500 }}
        >
          {session?.user?.userStatus === 'global' && (
            <MenuItem
              onClick={() => {
                router.push('/admin/users');
                setAnchorSettings(null);
              }}
            >
              User Settings
              <ManageAccountsRounded />
            </MenuItem>
          )}
          <MenuItem
            onClick={() => {
              router.push('/admin/sites');
              setAnchorSettings(null);
            }}
          >
            Site Settings
            <Public />
          </MenuItem>

          {session?.user?.userStatus === 'global' && (
            <MenuItem
              onClick={() => {
                router.push('/admin/userstosites');
                setAnchorSettings(null);
              }}
            >
              User-Site Assignments
              <GroupAdd />
            </MenuItem>
          )}
          {session?.user?.userStatus === 'global' && (
            <MenuItem
              onClick={() => {
                router.push('/admin/provision');
                setAnchorSettings(null);
              }}
            >
              Provisioning
              <AddCircleOutline />
            </MenuItem>
          )}
        </Menu>
      </Box>
    );
  }
};
