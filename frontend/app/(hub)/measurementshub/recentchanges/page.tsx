'use client';

import RenderGridFormExplanations from '@/components/client/rendergridformexplanations';
import IsolatedUnifiedChangelogDataGrid from '@/components/datagrids/applications/isolated/isolatedunifiedchangelogdatagrid';
import { DatagridType } from '@/config/macros/formdetails';

export default function RecentChangesPage() {
  return (
    <>
      <RenderGridFormExplanations datagridType={DatagridType.unifiedchangelog} />
      <IsolatedUnifiedChangelogDataGrid />
    </>
  );
}
