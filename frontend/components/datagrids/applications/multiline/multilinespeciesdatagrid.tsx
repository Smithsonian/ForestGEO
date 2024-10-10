'use client';
import React, { useState } from 'react';
import { useSession } from 'next-auth/react';
import IsolatedMultilineDataGridCommons from '@/components/datagrids/isolatedmultilinedatagridcommons';
import { SpeciesFormGridColumns } from '@/components/client/formcolumns';
import { DataGridSignals } from '@/config/macros/formdetails';

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
  const { data: session } = useSession();

  return (
    <IsolatedMultilineDataGridCommons
      gridType="species"
      gridColumns={SpeciesFormGridColumns}
      refresh={refresh}
      setRefresh={setRefresh}
      initialRow={initialSpeciesRow}
      setChangesSubmitted={setChangesSubmitted}
    />
  );
}
