'use client';

import React, { useState } from 'react';
import { useSession } from 'next-auth/react';
import IsolatedMultilineDataGridCommons from '@/components/datagrids/isolatedmultilinedatagridcommons';
import { PersonnelFormGridColumns } from '@/components/client/formcolumns';
import { DataGridSignals } from '@/config/macros/formdetails';

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
  const { data: session } = useSession();

  return (
    <IsolatedMultilineDataGridCommons
      gridType="personnel"
      gridColumns={PersonnelFormGridColumns}
      refresh={refresh}
      setRefresh={setRefresh}
      initialRow={initialPersonnelRow}
      setChangesSubmitted={setChangesSubmitted}
    />
  );
}
