// quadrats datagrid
'use client';
import React, { useState } from 'react';
import { useSession } from 'next-auth/react';
import UploadParentModal from '@/components/uploadsystemhelpers/uploadparentmodal';
import { quadratGridColumns } from '@/components/client/datagridcolumns';
import { FormType } from '@/config/macros/formdetails';
import { QuadratRDS } from '@/config/sqlrdsdefinitions/zones';
import IsolatedDataGridCommons from '@/components/datagrids/isolateddatagridcommons';
import { useOrgCensusContext, usePlotContext } from '@/app/contexts/userselectionprovider';
import MultilineModal from '@/components/datagrids/applications/multiline/multilinemodal';

export default function IsolatedQuadratsDataGrid() {
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const initialQuadratRDSRow: QuadratRDS = {
    id: 0,
    quadratID: 0,
    plotID: currentPlot?.plotID,
    quadratName: '',
    startX: 0,
    startY: 0,
    coordinateUnits: 'm',
    dimensionX: 0,
    dimensionY: 0,
    dimensionUnits: 'm',
    area: 0,
    areaUnits: 'm2',
    quadratShape: ''
  };
  const [refresh, setRefresh] = useState(false);
  const { data: session } = useSession();
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isManualEntryFormOpen, setIsManualEntryFormOpen] = useState(false);

  return (
    <>
      <UploadParentModal
        isUploadModalOpen={isUploadModalOpen}
        handleCloseUploadModal={() => {
          setIsUploadModalOpen(false);
          setRefresh(true);
        }}
        formType={FormType.quadrats}
      />
      <MultilineModal
        isManualEntryFormOpen={isManualEntryFormOpen}
        handleCloseManualEntryForm={() => {
          setIsManualEntryFormOpen(false);
          setRefresh(true);
        }}
        formType={'quadrats'}
      />
      <IsolatedDataGridCommons
        gridType="quadrats"
        gridColumns={quadratGridColumns}
        refresh={refresh}
        setRefresh={setRefresh}
        initialRow={initialQuadratRDSRow}
        fieldToFocus={'quadratName'}
        clusters={{
          Name: ['quadratName'],
          Coordinates: ['startX', 'startY', 'coordinateUnits'],
          Dimensions: ['dimensionX', 'dimensionY', 'dimensionUnits'],
          Area: ['area', 'areaUnits'],
          Misc: ['quadratShape']
        }}
        dynamicButtons={[
          { label: 'Manual Entry Form', onClick: () => setIsManualEntryFormOpen(true) },
          { label: 'Upload', onClick: () => setIsUploadModalOpen(true) }
        ]}
      />
    </>
  );
}
