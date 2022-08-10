import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Toolbar from '@mui/material/Toolbar';
import IconButton from '@mui/material/IconButton';
import AccountCircle from '@mui/icons-material/AccountCircle';
import SelectedMenu from './SelectedMenu';
import { useNavigate } from 'react-router-dom';
import React, { useEffect, useState } from 'react';
import Link from '@mui/material/Link';
import { Typography } from '@mui/material';
import GetUser from './GetUser';

export default function Navbar() {
  let navigate = useNavigate();
  interface clientPrincipal {
    userId: string;
    userRoles: string[];
    claims: string[];
    identityProvider: string;
    userDetails: string;
  }

  const userInfo: clientPrincipal | undefined = GetUser();

  return (
    <Box sx={{ flexGrow: 1 }}>
      <AppBar position="static">
        <Toolbar>
          <SelectedMenu />
          {userInfo ? (
            <>
              <Typography
                aria-label="menu"
                sx={{ color: 'white', ml: 'auto', mr: '10px' }}
              >
                {userInfo.userDetails}
              </Typography>
              <Link
                sx={{ textDecoration: 'underline', color: 'white' }}
                onClick={() => navigate('/logout')}
                href={`/logout`}
              >
                Logout
              </Link>
            </>
          ) : (
            <p></p>
          )}
          <IconButton size="large" color="inherit" aria-label="menu">
            <AccountCircle />
          </IconButton>
        </Toolbar>
      </AppBar>
    </Box>
  );
}
