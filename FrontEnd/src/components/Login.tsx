import React from 'react';
import { Typography } from '@mui/material';
import '../CSS/Login.css';
import image from '../login-image.png';
import Link from '@mui/material/Link';

export default function Login() {
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
