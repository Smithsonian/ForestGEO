import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Toolbar from '@mui/material/Toolbar';
import IconButton from '@mui/material/IconButton';
import AccountCircle from '@mui/icons-material/AccountCircle';
import SelectedMenu from './SelectedMenu';
import { useNavigate } from 'react-router-dom';
import React, { useEffect, useState } from 'react';

export default function Navbar() {
  const redirect = window.location.pathname;
  let navigate = useNavigate();

  return (
    <Box sx={{ flexGrow: 1 }}>
      <AppBar position="static">
        <Toolbar>
          <SelectedMenu />
          <IconButton
            size="large"
            color="inherit"
            aria-label="menu"
            sx={{ marginLeft: 'auto' }}
          >
            <AccountCircle />
          </IconButton>
        </Toolbar>
      </AppBar>
      <button onClick={() => navigate('/')}>
        <a href={`/.auth/logout?post_logout_redirect_uri=${redirect}`}>
          Logout
        </a>
      </button>
    </Box>
  );
}
