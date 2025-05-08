'use client';

import RenderGridFormExplanations from '@/components/client/rendergridformexplanations';
import ViewFullTableDataGrid from '@/components/datagrids/applications/viewfulltabledatagrid';
import { DatagridType } from '@/config/macros/formdetails';

export default function ViewFullTablePage() {
  return (
    <>
      <RenderGridFormExplanations datagridType={DatagridType.viewfulltable} />
      <ViewFullTableDataGrid />
    </>
  );
}
