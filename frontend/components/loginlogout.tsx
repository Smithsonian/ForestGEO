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
import { Menu, MenuItem, Skeleton } from '@mui/joy';
import { signIn, signOut, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { GroupAdd, ManageAccountsRounded, Public, Settings } from '@mui/icons-material';
import ailogger from '@/ailogger';

export const LoginLogout = () => {
  const { data: session, status } = useSession();
  const [anchorSettings, setAnchorSettings] = useState<HTMLElement | null>(null);
  const router = useRouter();
  const menuRef = useRef<HTMLUListElement | null>(null);
  const menuId = 'user-settings-menu';
  const isMenuOpen = Boolean(anchorSettings);

  useEffect(() => {
    if (isMenuOpen) {
      const firstItem = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
      firstItem?.focus();
    }
  }, [isMenuOpen]);

  const closeMenu = () => {
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
        .then(() => localStorage.clear())
        .then(() => sessionStorage.clear());
    });
  };

  if (status == 'unauthenticated') {
    return (
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }} data-testid={'login-logout-component'}>
        <Avatar variant="outlined" size="sm" alt={'unknown user (unauthenticated)'}>
          UNK
        </Avatar>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography level="title-sm">Login to access</Typography>
          <Typography level="body-xs">your information</Typography>
        </Box>
        <IconButton size="sm" variant="plain" color="neutral" onClick={() => handleRetryLogin()} aria-label={'Login' + ' button'}>
          <LoginRoundedIcon />
        </IconButton>
      </Box>
    );
  } else {
    return (
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }} data-testid={'login-logout-component'}>
        <IconButton
          aria-label={userInitials ? `${userInitials}, open user menu` : 'Open user menu'}
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
          aria-controls={isMenuOpen ? menuId : undefined}
          onClick={event => setAnchorSettings(anchorSettings ? null : event.currentTarget)}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setAnchorSettings(anchorSettings ? null : event.currentTarget);
            }
          }}
          size="sm"
        >
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
          disabled={!['global', 'db admin'].includes(session?.user?.userStatus ?? '')}
          onClick={event => setAnchorSettings(anchorSettings ? null : event.currentTarget)}
          aria-label="Settings menu"
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
          aria-controls={isMenuOpen ? menuId : undefined}
          title="Settings menu"
          size="sm"
        >
          <Skeleton loading={status == 'loading'}>
            <Settings />
          </Skeleton>
        </IconButton>
        <IconButton size="sm" variant="plain" color="neutral" onClick={() => void signOut({ redirectTo: '/login' })} aria-label={'Logout button'}>
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
          <MenuItem
            onClick={() => {
              router.push('/admin/users');
              closeMenu();
            }}
          >
            User Settings
            <ManageAccountsRounded />
          </MenuItem>
          <MenuItem
            onClick={() => {
              router.push('/admin/sites');
              closeMenu();
            }}
          >
            Site Settings
            <Public />
          </MenuItem>

          <MenuItem
            onClick={() => {
              router.push('/admin/userstosites');
              closeMenu();
            }}
          >
            User-Site Assignments
            <GroupAdd />
          </MenuItem>
        </Menu>
      </Box>
    );
  }
};
