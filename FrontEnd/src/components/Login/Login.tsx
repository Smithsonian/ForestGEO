import React from 'react';
import {Grid, Typography} from '@mui/material';
import image from './login.png';
import Link from '@mui/material/Link';
import GetUser, {clientPrincipal} from '../GetUser';
import {useNavigate} from 'react-router-dom';

export interface LoginPureProps {
}

/**
 * LoginPure welcomes people, and links to /login
 *
 * The presentational part of the Login component.
 */
export function LoginPure() {
  return (
    <Grid container spacing={2}>
      <Grid item xs={4}>
        <img
          src={image}
          alt="ForestGeo Logo"
          style={{
            maxWidth: '100%', // responsive image
            height: 'auto',
            padding: 0,
            margin: 0,
          }}
        />
      </Grid>
      <Grid item xs={8}>
        <Typography variant="h3" component="h1">
          Welcome to the ForestGEO web-app
        </Typography>
        <Link
          href={`/login`}
          sx={{
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <Typography variant="h4" component="h2" sx={{pt: '20%'}}>
            Login
          </Typography>
        </Link>
      </Grid>
    </Grid>
  );
}

export interface LoginProps {
}

/**
 * For logging into the app.
 *
 * If the user is already logged in, then we redirect them to /validate
 */
export default function Login() {
  let navigate = useNavigate();
  
  const userInfo: clientPrincipal | undefined = GetUser();
  
  React.useEffect(() => {
    if (userInfo) {
      navigate('/validate');
    }
  });
  return <LoginPure/>;
}
