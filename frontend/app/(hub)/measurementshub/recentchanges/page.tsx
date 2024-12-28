'use client';

import RenderGridExplanations from '@/components/client/rendergridexplanations';
import IsolatedUnifiedChangelogDataGrid from '@/components/datagrids/applications/isolated/isolatedunifiedchangelogdatagrid';
import { DatagridType } from '@/config/macros/formdetails';

export default function RecentChangesPage() {
  return (
    <>
      <RenderGridExplanations datagridType={DatagridType.unifiedchangelog} />
      <IsolatedUnifiedChangelogDataGrid />
    </>
  );
}
