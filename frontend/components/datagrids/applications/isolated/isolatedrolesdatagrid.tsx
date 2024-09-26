// roles datagrid
'use client';
import React, { useState } from 'react';
import { Box, Typography } from '@mui/joy';
import { useSession } from 'next-auth/react';
import { RolesGridColumns } from '@/components/client/datagridcolumns';
import { RoleRDS } from '@/config/sqlrdsdefinitions/personnel';
import IsolatedDataGridCommons from '@/components/datagrids/isolateddatagridcommons';

type IsolatedRolesDataGridProps = {
  onRolesUpdated: () => void; // Accept the onRolesUpdated prop
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
  const { data: session } = useSession();

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3, width: '100%' }}>
        <Box
          sx={{
            width: '100%',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: 'warning.main',
            borderRadius: '4px',
            p: 2
          }}
        >
          <Box sx={{ flexGrow: 1 }}>
            {session?.user.userStatus !== 'field crew' && (
              <Typography level={'title-lg'} sx={{ color: '#ffa726' }}>
                Note: ADMINISTRATOR VIEW
              </Typography>
            )}
          </Box>
        </Box>
      </Box>

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
      />
    </>
  );
}
