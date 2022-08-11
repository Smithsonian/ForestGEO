import { useEffect, useState } from 'react';

export interface clientPrincipal {
  userId: string;
  userRoles: string[];
  claims: string[];
  identityProvider: string;
  userDetails: string;
}

export default function GetUser() {
  const [userInfo, setUserInfo] = useState<clientPrincipal>();

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
  return userInfo;
}
