'use client';

// isolated unifiedchangelog datagrid
import React, { useState } from 'react';
import IsolatedDataGridCommons from '@/components/datagrids/isolateddatagridcommons';
import { useOrgCensusContext, usePlotContext } from '@/app/contexts/userselectionprovider';
import { UnifiedChangelogGridColumns } from '@/components/client/datagridcolumns';
import { UnifiedChangelogRDS } from '@/config/sqlrdsdefinitions/core';

export default function IsolatedUnifiedChangelogDataGrid() {
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const initialUCRDSRow: UnifiedChangelogRDS = {
    id: 0,
    changeID: 0,
    tableName: '',
    recordID: '',
    operation: '',
    oldRowState: {},
    newRowState: {},
    changeTimestamp: new Date(),
    changedBy: '',
    plotID: currentPlot?.plotID ?? 0,
    censusID: currentCensus?.dateRanges[0].censusID ?? 0
  };
  const [refresh, setRefresh] = useState(false);

  return (
    <>
      <IsolatedDataGridCommons
        gridType="unifiedchangelog"
        gridColumns={UnifiedChangelogGridColumns}
        refresh={refresh}
        setRefresh={setRefresh}
        initialRow={initialUCRDSRow}
        fieldToFocus={'tableName'}
        dynamicButtons={[]}
        locked={true}
      />
    </>
  );
}
