import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Toolbar from '@mui/material/Toolbar';
import IconButton from '@mui/material/IconButton';
import AccountCircle from '@mui/icons-material/AccountCircle';
import SelectedMenu from './SelectedMenu';
import React, { useEffect, useState } from 'react';

export default function Navbar() {
  const [userInfo, setUserInfo] = useState<any>();
  const providers = ['twitter', 'github', 'aad'];
  const redirect = window.location.pathname;

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

  console.log(userInfo);

  return (
    <Box sx={{ flexGrow: 1 }}>
      <AppBar position="static">
        <Toolbar>
          <SelectedMenu />
          {userInfo ? (
            <IconButton
              size="large"
              color="inherit"
              aria-label="menu"
              sx={{ marginLeft: 'auto' }}
            >
              <p>{userInfo.userDetails}</p>
              <AccountCircle />
            </IconButton>
          ) : (
            <a href="/.auth/login/github">
              <button>Login</button>
            </a>
          )}
        </Toolbar>
      </AppBar>
    </Box>
  );
}
