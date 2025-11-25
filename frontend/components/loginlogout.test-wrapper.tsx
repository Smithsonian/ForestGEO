// Test wrapper for LoginLogout component
// This allows Cypress tests to inject session data without module mocking issues

'use client';
import React, { useState } from 'react';
import Avatar from '@mui/joy/Avatar';
import Box from '@mui/joy/Box';
import Typography from '@mui/joy/Typography';
import IconButton from '@mui/joy/IconButton';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import LoginRoundedIcon from '@mui/icons-material/LoginRounded';
import CircularProgress from '@mui/joy/CircularProgress';
import { Menu, MenuItem, Skeleton } from '@mui/joy';
import { GroupAdd, ManageAccountsRounded, Public, Settings } from '@mui/icons-material';

interface LoginLogoutTestWrapperProps {
  session: any;
  status: 'authenticated' | 'unauthenticated' | 'loading';
  onSignIn?: () => void;
  onSignOut?: () => void;
  onRouterPush?: (path: string) => void;
}

export const LoginLogoutTestWrapper: React.FC<LoginLogoutTestWrapperProps> = ({
  session,
  status,
  onSignIn = () => {},
  onSignOut = () => {},
  onRouterPush = () => {}
}) => {
  const [anchorSettings, setAnchorSettings] = useState<HTMLElement | null>(null);

  if (status === 'unauthenticated') {
    return (
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }} data-testid={'login-logout-component'}>
        <Avatar variant="outlined" size="sm" alt={'unknown user (unauthenticated)'}>
          UNK
        </Avatar>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography level="title-sm">Login to access</Typography>
          <Typography level="body-xs">your information</Typography>
        </Box>
        <IconButton size="sm" variant="plain" color="neutral" onClick={onSignIn} aria-label={'Login button'}>
          <LoginRoundedIcon />
        </IconButton>
      </Box>
    );
  } else {
    return (
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }} data-testid={'login-logout-component'}>
        <IconButton
          aria-label={'user avatar icon button'}
          onClick={event => setAnchorSettings(anchorSettings ? null : event.currentTarget)}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setAnchorSettings(anchorSettings ? null : event.currentTarget);
            }
          }}
          size="sm"
        >
          <Avatar variant="outlined" size="sm" src="" alt={`Avatar for ${session?.user?.name || 'current user'}`}>
            <Skeleton loading={status === 'loading'}>
              {typeof session?.user?.name === 'string'
                ? session.user.name
                    .replace(/[^a-zA-Z- ]/g, '')
                    .match(/\b\w/g)
                    ?.join('')
                : ''}
            </Skeleton>
          </Avatar>
        </IconButton>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography level="title-sm">
            <Skeleton loading={status === 'loading'}>{session?.user?.name ? session.user.name : ''}</Skeleton>
          </Typography>
          <Typography
            level="body-xs"
            sx={{
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            <Skeleton loading={status === 'loading'}>{session?.user?.email ? session?.user?.email : ''}</Skeleton>
          </Typography>
        </Box>
        <IconButton
          disabled
          onClick={event => setAnchorSettings(anchorSettings ? null : event.currentTarget)}
          aria-label="Settings menu - Currently unavailable. Feature coming soon."
          title="Settings menu - Currently unavailable. Feature coming soon."
          size="sm"
        >
          <Skeleton loading={status === 'loading'}>
            <Settings />
          </Skeleton>
        </IconButton>
        <IconButton size="sm" variant="plain" color="neutral" onClick={onSignOut} aria-label={'Logout button'}>
          {status === 'loading' ? <CircularProgress size={'lg'} /> : <LogoutRoundedIcon />}
        </IconButton>
        <Menu
          anchorEl={anchorSettings}
          open={Boolean(anchorSettings)}
          onClose={() => setAnchorSettings(null)}
          placement={'top-end'}
          disablePortal
          sx={{ zIndex: 1500 }}
        >
          <MenuItem
            tabIndex={0}
            onClick={() => {
              onRouterPush('/admin/users');
              setAnchorSettings(null);
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                onRouterPush('/admin/users');
                setAnchorSettings(null);
              }
            }}
          >
            User Settings
            <ManageAccountsRounded />
          </MenuItem>
          <MenuItem
            tabIndex={0}
            onClick={() => {
              onRouterPush('/admin/sites');
              setAnchorSettings(null);
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                onRouterPush('/admin/sites');
                setAnchorSettings(null);
              }
            }}
          >
            Site Settings
            <Public />
          </MenuItem>

          <MenuItem
            tabIndex={0}
            onClick={() => {
              onRouterPush('/admin/userstosites');
              setAnchorSettings(null);
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                onRouterPush('/admin/userstosites');
                setAnchorSettings(null);
              }
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
