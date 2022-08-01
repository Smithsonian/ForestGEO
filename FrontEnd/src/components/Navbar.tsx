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
  const [userInfo, setUserInfo] = useState<any>();

  useEffect(() => {
    (async () => {
      setUserInfo(await getUserInfo());
    })();
  }, []);

  async function getUserInfo() {
    try {
      const response = await fetch('/.auth/me');
      const payload = await response.json();
      const { clientPrincipal } = payload;
      return clientPrincipal;
    } catch (error) {
      console.error('No profile could be found');
      return undefined;
    }
  }

  return (
    <Box sx={{ flexGrow: 1 }}>
      <AppBar position="static">
        <Toolbar>
          <SelectedMenu />
          {userInfo ? (
            <>
              <p aria-label="menu">{userInfo.userDetails}</p>
              <a onClick={() => navigate('/')} href={`/.auth/logout`}>
                Logout
              </a>
            </>
          ) : (
            <p></p>
          )}
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
    </Box>
  );
}
