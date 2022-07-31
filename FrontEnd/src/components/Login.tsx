import React from 'react';
import { Typography } from '@mui/material';
import { useState, useEffect } from 'react';
import '../CSS/Login.css';
import image from '../login-image.png';
import Validate from '../pages/Validate';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useNavigate } from 'react-router-dom';
import App from '../App';

export default function Login() {
  const [userInfo, setUserInfo] = useState<any>();
  const providers = ['twitter', 'github', 'aad'];
  const redirect = window.location.pathname;
  let navigate = useNavigate();

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
    <div>
      <div>{userInfo && <Validate></Validate>}</div>
      <div>
        {!userInfo && (
          <Typography id={'login'}>
            <div>
              <img src={image} />
            </div>
            <div id={'loginForm'}>
              <h1 id={'loginTitle'}>Login to save the environment!</h1>
              <form id="form" noValidate>
                <a
                  key={'github'}
                  id={'loginButton'}
                  href={`/.auth/login/github?post_login_redirect_uri=${redirect}`}
                >
                  github
                </a>

                <a
                  key={'google'}
                  id={'loginButton'}
                  href={`/.auth/login/google?post_login_redirect_uri=${redirect}`}
                >
                  google
                </a>
              </form>
            </div>
          </Typography>
        )}
      </div>
    </div>
  );
}
