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
    coordinateunit: '',
    dimx: 0,
    dimy: 0,
    dimensionunit: '',
    area: 0,
    areaunit: '',
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
