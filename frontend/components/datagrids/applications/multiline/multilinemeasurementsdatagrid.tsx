'use client';

// multiline measurements datagrid
import React, { useState } from 'react';
import { useSession } from 'next-auth/react';
import IsolatedMultilineDataGridCommons from '@/components/datagrids/isolatedmultilinedatagridcommons';
import { MeasurementsFormGridColumns } from '@/components/client/formcolumns';
import { DataGridSignals } from '@/config/macros/formdetails';

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
    <IsolatedMultilineDataGridCommons
      gridType="measurements"
      gridColumns={MeasurementsFormGridColumns}
      refresh={refresh}
      setRefresh={setRefresh}
      initialRow={initialMeasurementsFormRow}
      setChangesSubmitted={setChangesSubmitted}
    />
  );
}
