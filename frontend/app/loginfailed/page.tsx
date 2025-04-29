import LoginFailed from '@/components/client/modals/loginfailure';
import { Suspense } from 'react';

export default function LoginFailedPage() {
  return (
    <Suspense>
      <LoginFailed />
    </Suspense>
  );
}
