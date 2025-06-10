// loginlogout.tsx
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
import { signIn, signOut, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { GroupAdd, ManageAccountsRounded, Public, Settings } from '@mui/icons-material';

export const LoginLogout = () => {
  const { data: session, status } = useSession();
  const [anchorSettings, setAnchorSettings] = useState<HTMLElement | null>(null);
  const router = useRouter();

  const handleRetryLogin = () => {
    signIn('microsoft-entra-id', { redirectTo: '/dashboard' }).catch((error: any) => {
      console.error('Login error:', error);
      signOut({ redirectTo: `/loginfailed?reason=${error.message}` })
        .then(() => localStorage.clear())
        .then(() => sessionStorage.clear());
    });
  };

  if (status == 'unauthenticated') {
    return (
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }} data-testid={'login-logout-component'}>
        <Avatar variant="outlined" size="sm">
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
        <IconButton onClick={event => setAnchorSettings(anchorSettings ? null : event.currentTarget)} size="sm">
          <Avatar variant="outlined" size="sm" src="">
            <Skeleton loading={status == 'loading'}>
              {typeof session?.user?.name == 'string'
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
        <IconButton onClick={event => setAnchorSettings(anchorSettings ? null : event.currentTarget)} size="sm">
          <Skeleton loading={status == 'loading'}>
            <Settings />
          </Skeleton>
        </IconButton>
        <IconButton size="sm" variant="plain" color="neutral" onClick={() => void signOut({ redirectTo: '/login' })} aria-label={'Logout button'}>
          {status == 'loading' ? <CircularProgress size={'lg'} /> : <LogoutRoundedIcon />}
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
            onClick={() => {
              router.push('/admin/users');
              setAnchorSettings(null);
            }}
          >
            User Settings
            <ManageAccountsRounded />
          </MenuItem>
          <MenuItem
            onClick={() => {
              router.push('/admin/sites');
              setAnchorSettings(null);
            }}
          >
            Site Settings
            <Public />
          </MenuItem>
          <MenuItem
            onClick={() => {
              router.push('/admin/usersiteassignments');
              setAnchorSettings(null);
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
