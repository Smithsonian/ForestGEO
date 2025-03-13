'use client';

// isolated failedmeasurements datagrid
import React, { useState } from 'react';
import { FailedMeasurementsGridColumns } from '@/components/client/datagridcolumns';
import IsolatedDataGridCommons from '@/components/datagrids/isolateddatagridcommons';
import { useOrgCensusContext, usePlotContext } from '@/app/contexts/userselectionprovider';

export default function IsolatedFailedMeasurementsDataGrid() {
  const [refresh, setRefresh] = useState(false);
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();

  const initialFailedMeasurementsRow = {
    id: 0,
    failedMeasurementID: 0,
    plotID: currentPlot?.plotID,
    censusID: currentCensus?.dateRanges[0].censusID,
    tag: '',
    stemTag: '',
    spCode: '',
    quadrat: '',
    x: 0,
    y: 0,
    dbh: 0,
    hom: 0,
    date: null,
    codes: ''
  };

  return (
    <>
      <IsolatedDataGridCommons
        gridType="failedmeasurements"
        gridColumns={FailedMeasurementsGridColumns}
        refresh={refresh}
        setRefresh={setRefresh}
        initialRow={initialFailedMeasurementsRow}
        fieldToFocus={'tag'}
        dynamicButtons={[]}
      />
    </>
  );
}
