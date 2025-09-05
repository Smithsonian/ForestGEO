// stemtaxonomiesview datagrid
'use client';
import React, { useState } from 'react';
import { useSession } from 'next-auth/react';
import UploadParentModal from '@/components/uploadsystemhelpers/uploadparentmodal';
import { StemTaxonomiesViewGridColumns } from '@/components/client/datagridcolumns';
import { FormType } from '@/config/macros/formdetails';
import { StemTaxonomiesViewRDS } from '@/config/sqlrdsdefinitions/views';
import IsolatedDataGridCommons from '@/components/datagrids/isolateddatagridcommons';

export default function IsolatedStemTaxonomiesViewDataGrid() {
  const initialStemTaxonomiesViewRDSRow: StemTaxonomiesViewRDS = {
    id: 0,
    stemGUID: 0,
    treeID: 0,
    speciesID: 0,
    genusID: 0,
    familyID: 0,
    quadratID: 0,
    stemTag: '',
    treeTag: '',
    speciesCode: '',
    family: '',
    genus: '',
    speciesName: '',
    subspeciesName: '',
    validCode: '',
    genusAuthority: '',
    speciesAuthority: '',
    subspeciesAuthority: '',
    idLevel: '',
    fieldFamily: ''
  };
  const [refresh, setRefresh] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const { data: session } = useSession();

  return (
    <>
      <UploadParentModal
        isUploadModalOpen={isUploadModalOpen}
        handleCloseUploadModal={() => {
          setIsUploadModalOpen(false);
          setRefresh(true);
        }}
        formType={FormType.species}
      />

      <IsolatedDataGridCommons
        locked
        gridType="stemtaxonomiesview"
        gridColumns={StemTaxonomiesViewGridColumns}
        refresh={refresh}
        setRefresh={setRefresh}
        initialRow={initialStemTaxonomiesViewRDSRow}
        fieldToFocus={'stemTag'}
        clusters={{
          Stem: ['stemTag'],
          Tree: ['treeTag'],
          Family: ['family'],
          Genus: ['genus', 'genusAuthority'],
          Species: ['speciesCode', 'speciesName', 'validCode', 'speciesAuthority', 'speciesIDLevel', 'speciesFieldFamily'],
          Subspecies: ['subspeciesName', 'subspeciesAuthority']
        }}
        dynamicButtons={[{ label: 'Upload', onClick: () => setIsUploadModalOpen(true) }]}
      />
    </>
  );
}
