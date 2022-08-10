import React from 'react';
import { Typography } from '@mui/material';
import '../CSS/Login.css';
import image from '../login-image.png';
import Link from '@mui/material/Link';
import GetUser from './GetUser';
import { useNavigate } from 'react-router-dom';

export default function Login() {
  let navigate = useNavigate();
  interface clientPrincipal {
    userId: string;
    userRoles: string[];
    claims: string[];
    identityProvider: string;
    userDetails: string;
  }

  const userInfo: clientPrincipal | undefined = GetUser();

  React.useEffect(() => {
    if (userInfo) {
      navigate('/validate');
    }
  });

  return (
    <div>
      <Typography id={'login'}>
        <div>
          <img src={image} alt="ForestGeo Logo" />
        </div>
        <div id={'loginForm'}>
          <h1 id={'loginTitle'}>Login to save the environment!</h1>
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
