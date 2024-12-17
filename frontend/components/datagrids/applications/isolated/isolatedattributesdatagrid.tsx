'use client';

// isolated attributes datagrid
import React, { useState } from 'react';
import UploadParentModal from '@/components/uploadsystemhelpers/uploadparentmodal';
import { AttributeGridColumns } from '@/components/client/datagridcolumns';
import { FormType } from '@/config/macros/formdetails';
import IsolatedDataGridCommons from '@/components/datagrids/isolateddatagridcommons';
import MultilineModal from '@/components/datagrids/applications/multiline/multilinemodal';

export default function IsolatedAttributesDataGrid() {
  const initialAttributesRDSRow = {
    id: 0,
    code: '',
    description: '',
    status: ''
  };
  const [refresh, setRefresh] = useState(false);
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
        formType={FormType.attributes}
      />

      <MultilineModal
        isManualEntryFormOpen={isManualEntryFormOpen}
        handleCloseManualEntryForm={() => {
          setIsManualEntryFormOpen(false);
          setRefresh(true);
        }}
        formType={'attributes'}
      />

      <IsolatedDataGridCommons
        gridType="attributes"
        gridColumns={AttributeGridColumns}
        refresh={refresh}
        setRefresh={setRefresh}
        initialRow={initialAttributesRDSRow}
        fieldToFocus={'code'}
        clusters={{
          Code: ['code'],
          Description: ['description'],
          Status: ['status']
        }}
        dynamicButtons={[
          { label: 'Manual Entry Form', onClick: () => setIsManualEntryFormOpen(true), tooltip: 'Submit data by filling out a form' },
          { label: 'Upload', onClick: () => setIsUploadModalOpen(true), tooltip: 'Submit data by uploading a CSV file' }
        ]}
      />
    </>
  );
}
