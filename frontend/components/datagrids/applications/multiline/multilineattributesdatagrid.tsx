'use client';

// isolated attributes datagrid
import React, { useState } from 'react';
import { useSession } from 'next-auth/react';
import IsolatedMultilineDataGridCommons from '@/components/datagrids/isolatedmultilinedatagridcommons';
import { AttributesFormGridColumns } from '@/components/client/formcolumns';
import { DataGridSignals } from '@/config/macros/formdetails';

export default function MultilineAttributesDataGrid(props: DataGridSignals) {
  const { setChangesSubmitted } = props;
  const initialAttributesRDSRow = {
    id: 0,
    code: '',
    description: '',
    status: ''
  };
  const [refresh, setRefresh] = useState(false);
  const { data: session } = useSession();

  return (
    <IsolatedMultilineDataGridCommons
      gridType="attributes"
      gridColumns={AttributesFormGridColumns}
      refresh={refresh}
      setRefresh={setRefresh}
      initialRow={initialAttributesRDSRow}
      setChangesSubmitted={setChangesSubmitted}
    />
  );
}
