// clearcookiesonunload.tsx
'use client';

import { useEffect } from 'react';

export default function ClearCookiesOnUnload() {
  useEffect(() => {
    function handleBeforeUnload() {
      navigator.sendBeacon(`/api/clearallcookies`);
    }

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);
  return null;
}
