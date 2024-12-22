'use client';

import React, { useState } from 'react';
import IsolatedMultilineDataGridCommons from '@/components/datagrids/isolatedmultilinedatagridcommons';
import { PersonnelFormGridColumns } from '@/components/client/formcolumns';
import { DataGridSignals, FormType } from '@/config/macros/formdetails';
import { Box } from '@mui/joy';
import RenderFormExplanations from '@/components/client/renderformexplanations';

export default function MultilinePersonnelDataGrid(props: DataGridSignals) {
  const { setChangesSubmitted } = props;
  const initialPersonnelRow = {
    id: 0,
    firstname: '',
    lastname: '',
    role: '',
    roledescription: ''
  };
  const [refresh, setRefresh] = useState(false);

  return (
    <Box>
      {RenderFormExplanations(FormType.personnel)}
      <IsolatedMultilineDataGridCommons
        gridType="personnel"
        gridColumns={PersonnelFormGridColumns}
        refresh={refresh}
        setRefresh={setRefresh}
        initialRow={initialPersonnelRow}
        setChangesSubmitted={setChangesSubmitted}
      />
    </Box>
  );
}
