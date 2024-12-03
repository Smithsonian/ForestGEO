'use client';

import { MeasurementsSummaryStagingRDS } from '@/config/sqlrdsdefinitions/views';
import { useOrgCensusContext, usePlotContext } from '@/app/contexts/userselectionprovider';
import React, { useState } from 'react';
import UploadParentModal from '@/components/uploadsystemhelpers/uploadparentmodal';
import { FormType } from '@/config/macros/formdetails';
import IsolatedDataGridCommons from '@/components/datagrids/isolateddatagridcommons';
import { MeasurementsSummaryViewGridColumns } from '@/components/client/datagridcolumns';

export default function IsolatedMeasurementsSummaryDraftDataGrid() {
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const initialMeasurementsSummaryStagingRDSRow: MeasurementsSummaryStagingRDS = {
    id: 0,
    coreMeasurementID: 0,
    censusID: currentCensus?.dateRanges[0].censusID,
    quadratID: 0,
    plotID: currentPlot?.plotID,
    treeID: 0,
    stemID: 0,
    speciesID: 0,
    submittedBy: 0,
    quadratName: '',
    speciesName: '',
    subspeciesName: '',
    speciesCode: '',
    treeTag: '',
    stemTag: '',
    stemLocalX: 0,
    stemLocalY: 0,
    coordinateUnits: '',
    measurementDate: null,
    measuredDBH: 0,
    dbhUnits: '',
    measuredHOM: 0,
    homUnits: '',
    isValidated: false,
    description: '',
    attributes: ''
  };
  const [refresh, setRefresh] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  return (
    <>
      <UploadParentModal
        isUploadModalOpen={isUploadModalOpen}
        handleCloseUploadModal={() => {
          setIsUploadModalOpen(false);
          setRefresh(true);
        }}
        formType={FormType.measurements}
      />
      <IsolatedDataGridCommons
        gridType="measurementssummary_staging"
        gridColumns={MeasurementsSummaryViewGridColumns}
        refresh={refresh}
        setRefresh={setRefresh}
        initialRow={initialMeasurementsSummaryStagingRDSRow}
        fieldToFocus={'quadratName'}
        dynamicButtons={[{ label: 'Upload', onClick: () => setIsUploadModalOpen(true) }]}
      />
    </>
  );
}
