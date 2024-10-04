'use client';

// isolated attributes datagrid
import React, { useState } from 'react';
import { Box, Typography } from '@mui/joy';
import { useSession } from 'next-auth/react';
import { AttributeGridColumns } from '@/components/client/datagridcolumns';
import IsolatedMultilineDataGridCommons from '@/components/datagrids/isolatedmultilinedatagridcommons';

export default function MultilineAttributesDataGrid() {
  const initialAttributesRDSRow = {
    id: 0,
    code: '',
    description: '',
    status: ''
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

      <IsolatedMultilineDataGridCommons
        gridType="attributes"
        gridColumns={AttributeGridColumns}
        refresh={refresh}
        setRefresh={setRefresh}
        initialRow={initialAttributesRDSRow}
      />
    </>
  );
}
