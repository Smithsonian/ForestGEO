import React from 'react';
import { Typography } from '@mui/material';
import './Login.css';
import image from './login.png';
import Link from '@mui/material/Link';
import GetUser, { clientPrincipal } from '../GetUser';
import { useNavigate } from 'react-router-dom';

export interface LoginPureProps {}

/**
 * The presentational part of the Login component.
 */
export function LoginPure() {
  return (
    <div>
      <Typography id={'login'}>
        <div>
          <img src={image} alt="ForestGeo Logo" />
        </div>
        <div id={'loginForm'}>
          <h1 id={'loginTitle'}>Login Page</h1>
          <form id="form" noValidate>
            <Link key={'microsoft'} id={'microsoftButton'} href={`/login`}>
              Login with Microsoft
            </Link>
          </form>
        </div>
      </Typography>
    </div>
  );
}

export interface LoginProps {}

/**
 * For logging into the app.
 */
export default function Login() {
  let navigate = useNavigate();

  const userInfo: clientPrincipal | undefined = GetUser();

  React.useEffect(() => {
    if (userInfo) {
      navigate('/validate');
    }
  });
  return <LoginPure />;
}
