import React from 'react';
import { Typography } from '@mui/material';
import { useState, useEffect } from 'react';
import '../CSS/Login.css';
import image from '../login-image.png';
import Validate from '../pages/Validate';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useNavigate } from 'react-router-dom';
import Link from '@mui/material/Link';

export default function Login() {
  const redirect = window.location.pathname;

  return (
    <div>
      <Typography id={'login'}>
        <div>
          <img src={image} />
        </div>
        <div id={'loginForm'}>
          <h1 id={'loginTitle'}>Login to save the environment!</h1>
          <form id="form" noValidate>
            <Link
              key={'microsoft'}
              id={'microsoftButton'}
              href={`/.auth/login/microsoft?post_login_redirect_uri=${redirect}`}
            >
              Login with Microsoft
            </Link>
          </form>
        </div>
      </Typography>
    </div>
  );
}
