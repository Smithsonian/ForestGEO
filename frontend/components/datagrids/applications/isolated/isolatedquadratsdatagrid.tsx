// quadrats datagrid
'use client';
import React, { useState } from 'react';
import { useSession } from 'next-auth/react';
import UploadParentModal from '@/components/uploadsystemhelpers/uploadparentmodal';
import { QuadratGridColumns } from '@/components/client/datagridcolumns';
import { FormType } from '@/config/macros/formdetails';
import { QuadratRDS } from '@/config/sqlrdsdefinitions/zones';
import IsolatedDataGridCommons from '@/components/datagrids/isolateddatagridcommons';
import { usePlotContext } from '@/app/contexts/userselectionprovider';
import MultilineModal from '@/components/datagrids/applications/multiline/multilinemodal';

export default function IsolatedQuadratsDataGrid() {
  const currentPlot = usePlotContext();
  const initialQuadratRDSRow: QuadratRDS = {
    id: 0,
    quadratID: 0,
    plotID: currentPlot?.plotID,
    quadratName: '',
    startX: 0,
    startY: 0,
    dimensionX: 0,
    dimensionY: 0,
    area: 0,
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
        gridColumns={QuadratGridColumns}
        refresh={refresh}
        setRefresh={setRefresh}
        initialRow={initialQuadratRDSRow}
        fieldToFocus={'quadratName'}
        clusters={{
          Name: ['quadratName'],
          Coordinates: ['startX', 'startY'],
          Dimensions: ['dimensionX', 'dimensionY'],
          Area: ['area'],
          Misc: ['quadratShape']
        }}
        dynamicButtons={[
          { label: 'Manual Entry Form', onClick: () => setIsManualEntryFormOpen(true), tooltip: 'Submit data by filling out a form' },
          { label: 'Upload', onClick: () => setIsUploadModalOpen(true), tooltip: 'Submit data by uploading a CSV file' }
        ]}
      />
    </>
  );
}
