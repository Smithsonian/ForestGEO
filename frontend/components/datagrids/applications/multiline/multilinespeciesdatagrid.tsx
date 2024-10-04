'use client';
import React, { useState } from 'react';
import { Box, Typography } from '@mui/joy';
import { useSession } from 'next-auth/react';
import IsolatedMultilineDataGridCommons from '@/components/datagrids/isolatedmultilinedatagridcommons';
import { SpeciesFormGridColumns } from '@/components/client/formcolumns';

export default function MultilineSpeciesDataGrid() {
  const initialSpeciesRow = {
    id: 0,
    spcode: '',
    family: '',
    genus: '',
    species: '',
    subspecies: '',
    idlevel: '',
    authority: '',
    subspeciesauthority: ''
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
        gridType="species"
        gridColumns={SpeciesFormGridColumns}
        refresh={refresh}
        setRefresh={setRefresh}
        initialRow={initialSpeciesRow}
      />
    </>
  );
}
