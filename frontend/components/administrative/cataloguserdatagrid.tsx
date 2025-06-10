// cataloguserdatagrid.tsx
'use client';

import { GridColDef } from '@mui/x-data-grid';
import { standardizeGridColumns } from '@/components/client/clientmacros';
import { useState } from 'react';
import IsolatedDataGridCommons from '@/components/datagrids/isolateddatagridcommons';
import { useSession } from 'next-auth/react';

const columns: GridColDef[] = standardizeGridColumns([
  {
    field: 'firstName',
    headerName: 'First Name',
    flex: 0.3,
    editable: true
  },
  {
    field: 'lastName',
    headerName: 'Last Name',
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
    field: 'isAdmin',
    headerName: 'Email Notifications?',
    flex: 0.25,
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
  const { data: session } = useSession();
  return (
    <IsolatedDataGridCommons
      initialRow={{
        id: 0,
        lastName: '',
        firstName: '',
        email: '',
        isAdmin: false,
        userStatus: 'field crew'
      }}
      fieldToFocus={'firstName'}
      gridType={'users'}
      gridColumns={columns}
      refresh={refresh}
      setRefresh={setRefresh}
      dynamicButtons={[]}
      adminEmail={session?.user?.email}
    />
  );
}
