'use client';

import React, { useState } from 'react';
import { useSession } from 'next-auth/react';
import IsolatedMultilineDataGridCommons from '@/components/datagrids/isolatedmultilinedatagridcommons';
import { QuadratsFormGridColumns } from '@/components/client/formcolumns';
import { DataGridSignals } from '@/config/macros/formdetails';

export default function MultilineQuadratsDataGrid(props: DataGridSignals) {
  const { setChangesSubmitted } = props;
  const initialQuadratsRow = {
    id: 0,
    quadrat: '',
    startx: 0,
    starty: 0,
    dimx: 0,
    dimy: 0,
    area: 0,
    quadratshape: ''
  };
  const [refresh, setRefresh] = useState(false);
  const { data: session } = useSession();

  return (
    <IsolatedMultilineDataGridCommons
      gridType="quadrats"
      gridColumns={QuadratsFormGridColumns}
      refresh={refresh}
      setRefresh={setRefresh}
      initialRow={initialQuadratsRow}
      setChangesSubmitted={setChangesSubmitted}
    />
  );
}
