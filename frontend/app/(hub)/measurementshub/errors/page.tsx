import { Suspense } from 'react';
import ErrorsExplorer from '@/components/errors/errorsexplorer';

// ErrorsExplorer reads useSearchParams for its deep links, which needs a Suspense boundary.
export default function ErrorsPage() {
  return (
    <Suspense>
      <ErrorsExplorer />
    </Suspense>
  );
}
