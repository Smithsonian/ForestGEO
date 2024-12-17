'use client';

// isolated attributes datagrid
import React, { useState } from 'react';
import IsolatedMultilineDataGridCommons from '@/components/datagrids/isolatedmultilinedatagridcommons';
import { AttributesFormGridColumns } from '@/components/client/formcolumns';
import { DataGridSignals, FormType } from '@/config/macros/formdetails';
import { Box } from '@mui/joy';
import RenderFormExplanations from '@/components/client/renderformexplanations';

export default function MultilineAttributesDataGrid(props: DataGridSignals) {
  const { setChangesSubmitted } = props;
  const initialAttributesRDSRow = {
    id: 0,
    code: '',
    description: '',
    status: ''
  };
  const [refresh, setRefresh] = useState(false);

  return (
    <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
      {RenderFormExplanations(FormType.attributes)}
      <IsolatedMultilineDataGridCommons
        gridType="attributes"
        gridColumns={AttributesFormGridColumns}
        refresh={refresh}
        setRefresh={setRefresh}
        initialRow={initialAttributesRDSRow}
        setChangesSubmitted={setChangesSubmitted}
      />
    </Box>
  );
}
