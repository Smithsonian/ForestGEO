'use client';

// multiline measurements datagrid
import React, { useState } from 'react';
import IsolatedMultilineDataGridCommons from '@/components/datagrids/isolatedmultilinedatagridcommons';
import { MeasurementsFormGridColumns } from '@/components/client/formcolumns';
import { DataGridSignals, FormType } from '@/config/macros/formdetails';
import { Box } from '@mui/joy';
import RenderFormExplanations from '@/components/client/renderformexplanations';

export default function MultilineMeasurementsDataGrid(props: DataGridSignals) {
  const { setChangesSubmitted } = props;
  const initialMeasurementsFormRow = {
    id: 0,
    tag: '',
    stemtag: '',
    spcode: '',
    quadrat: '',
    lx: 0,
    ly: 0,
    dbh: 0,
    hom: 0,
    date: null,
    codes: ''
  };
  const [refresh, setRefresh] = useState(false);

  return (
    <Box>
      {RenderFormExplanations(FormType.measurements)}
      <IsolatedMultilineDataGridCommons
        gridType="measurements"
        gridColumns={MeasurementsFormGridColumns}
        refresh={refresh}
        setRefresh={setRefresh}
        initialRow={initialMeasurementsFormRow}
        setChangesSubmitted={setChangesSubmitted}
      />
    </Box>
  );
}
