// roles datagrid
'use client';
import React, { useState } from 'react';
import { RolesGridColumns } from '@/components/client/datagridcolumns';
import { RoleRDS } from '@/config/sqlrdsdefinitions/personnel';
import IsolatedDataGridCommons from '@/components/datagrids/isolateddatagridcommons';

type IsolatedRolesDataGridProps = {
  onRolesUpdated: () => void;
};

export default function IsolatedRolesDataGrid(props: IsolatedRolesDataGridProps) {
  const { onRolesUpdated } = props;
  const initialRoleRDSRow: RoleRDS = {
    id: 0,
    roleID: 0,
    roleName: '',
    roleDescription: ''
  };
  const [refresh, setRefresh] = useState(false);

  return (
    <>
      <IsolatedDataGridCommons
        gridType="roles"
        gridColumns={RolesGridColumns}
        refresh={refresh}
        setRefresh={setRefresh}
        initialRow={initialRoleRDSRow}
        fieldToFocus={'roleName'}
        onDataUpdate={onRolesUpdated}
        clusters={{
          Role: ['roleName', 'roleDescription']
        }}
        dynamicButtons={[]}
      />
    </>
  );
}
