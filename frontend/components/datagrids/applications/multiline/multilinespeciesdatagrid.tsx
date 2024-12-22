'use client';
import React, { useState } from 'react';
import IsolatedMultilineDataGridCommons from '@/components/datagrids/isolatedmultilinedatagridcommons';
import { SpeciesFormGridColumns } from '@/components/client/formcolumns';
import { DataGridSignals, FormType } from '@/config/macros/formdetails';
import { Box } from '@mui/joy';
import RenderFormExplanations from '@/components/client/renderformexplanations';

export default function MultilineSpeciesDataGrid(props: DataGridSignals) {
  const { setChangesSubmitted } = props;
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

  return (
    <Box>
      {RenderFormExplanations(FormType.species)}
      <IsolatedMultilineDataGridCommons
        gridType="species"
        gridColumns={SpeciesFormGridColumns}
        refresh={refresh}
        setRefresh={setRefresh}
        initialRow={initialSpeciesRow}
        setChangesSubmitted={setChangesSubmitted}
      />
    </Box>
  );
}
