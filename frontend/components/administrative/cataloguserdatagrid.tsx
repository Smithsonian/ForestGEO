// cataloguserdatagrid.tsx
'use client';

import { GridColDef } from '@mui/x-data-grid';
import { standardizeGridColumns } from '@/components/client/clientmacros';
import { useState } from 'react';
import IsolatedDataGridCommons from '@/components/datagrids/isolateddatagridcommons';

const columns: GridColDef[] = standardizeGridColumns([
  {
    field: 'lastName',
    headerName: 'Last Name',
    flex: 0.3,
    editable: true
  },
  {
    field: 'firstName',
    headerName: 'First Name',
    flex: 0.3,
    editable: true
  },
  {
    field: 'email',
    headerName: 'Email',
    flex: 0.5,
    editable: true
  },
  {
    field: 'userStatus',
    headerName: 'User Status',
    flex: 0.3,
    editable: true
  }
]);

export default function CatalogUserDatagrid() {
  const [refresh, setRefresh] = useState(false);
  return <IsolatedDataGridCommons gridType={'users'} gridColumns={columns} refresh={refresh} setRefresh={setRefresh} dynamicButtons={[]} />;
}
