'use client';

// multiline measurements datagrid
import React, { useState } from 'react';
import { Box, Typography } from '@mui/joy';
import { useSession } from 'next-auth/react';
import IsolatedMultilineDataGridCommons from '@/components/datagrids/isolatedmultilinedatagridcommons';
import { MeasurementsFormGridColumns } from '@/components/client/formcolumns';

/**
 *   [FormType.measurements]: [
 *     { label: 'tag' },
 *     { label: 'stemtag' },
 *     { label: 'spcode' },
 *     { label: 'quadrat' },
 *     { label: 'lx' },
 *     { label: 'ly' },
 *     { label: 'coordinateunit' },
 *     { label: 'dbh' },
 *     { label: 'dbhunit' },
 *     { label: 'hom' },
 *     { label: 'homunit' },
 *     { label: 'date' },
 *     { label: 'codes' }
 *   ],
 */
export default function MultilineMeasurementsDataGrid() {
  const initialMeasurementsFormRow = {
    id: 0,
    tag: '',
    stemtag: '',
    spcode: '',
    quadrat: '',
    lx: 0,
    ly: 0,
    coordinateunit: '',
    dbh: 0,
    dbhunit: '',
    hom: 0,
    homunit: '',
    date: null,
    codes: ''
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
        gridType="measurements"
        gridColumns={MeasurementsFormGridColumns}
        refresh={refresh}
        setRefresh={setRefresh}
        initialRow={initialMeasurementsFormRow}
      />
    </>
  );
}
