import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Toolbar from '@mui/material/Toolbar';
import IconButton from '@mui/material/IconButton';
import AccountCircle from '@mui/icons-material/AccountCircle';
import PageMenu from '../PageMenu';
import Link from '@mui/material/Link';
import {Typography} from '@mui/material';
import GetUser, {clientPrincipal} from '../GetUser';

export interface NavbarProps {
  userDetails?: string;
}

export default function Navbar() {
  const user: clientPrincipal | undefined = GetUser();
  return <NavbarPure userDetails={user?.userDetails}/>;
}

export function NavbarPure({userDetails}: NavbarProps) {
  return (
    <Box sx={{flexGrow: 1}}>
      <AppBar position="static">
        <Toolbar>
          <PageMenu/>
          {userDetails ? (
            <>
              <Typography
                aria-label="menu"
                sx={{color: 'white', ml: 'auto', mr: '10px'}}
              >
                {userDetails}
              </Typography>
              <Link
                sx={{textDecoration: 'underline', color: 'white'}}
                href={`/logout`}
              >
                Logout
              </Link>
            </>
          ) : (
            <p></p>
          )}
          <IconButton size="large" color="inherit" aria-label="menu">
            <AccountCircle/>
          </IconButton>
        </Toolbar>
      </AppBar>
    </Box>
  );
}
