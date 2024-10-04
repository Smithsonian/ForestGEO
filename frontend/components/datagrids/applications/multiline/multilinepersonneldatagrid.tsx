'use client';

import React, { useState } from 'react';
import { Box, Typography } from '@mui/joy';
import { useSession } from 'next-auth/react';
import IsolatedMultilineDataGridCommons from '@/components/datagrids/isolatedmultilinedatagridcommons';
import { PersonnelFormGridColumns } from '@/components/client/formcolumns';

export default function MultilinePersonnelDataGrid() {
  const initialPersonnelRow = {
    id: 0,
    firstname: '',
    lastname: '',
    role: '',
    roledescription: ''
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
        gridType="personnel"
        gridColumns={PersonnelFormGridColumns}
        refresh={refresh}
        setRefresh={setRefresh}
        initialRow={initialPersonnelRow}
      />
    </>
  );
}
