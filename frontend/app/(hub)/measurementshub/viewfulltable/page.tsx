'use client';

import RenderGridExplanations from '@/components/client/rendergridexplanations';
import ViewFullTableDataGrid from '@/components/datagrids/applications/viewfulltabledatagrid';
import { DatagridType } from '@/config/macros/formdetails';

export default function ViewFullTablePage() {
  return (
    <>
      <RenderGridExplanations datagridType={DatagridType.viewfulltable} />
      <ViewFullTableDataGrid />
    </>
  );
}
