// stemtaxonomiesview datagrid
'use client';
import React, { useState } from 'react';
import { Box, Button, Typography } from '@mui/joy';
import { useSession } from 'next-auth/react';
import UploadParentModal from '@/components/uploadsystemhelpers/uploadparentmodal';
import { StemTaxonomiesViewGridColumns } from '@/components/client/datagridcolumns';
import { FormType } from '@/config/macros/formdetails';
import { StemTaxonomiesViewRDS } from '@/config/sqlrdsdefinitions/views';
import IsolatedDataGridCommons from '@/components/datagrids/isolateddatagridcommons';

export default function IsolatedStemTaxonomiesViewDataGrid() {
  const initialStemTaxonomiesViewRDSRow: StemTaxonomiesViewRDS = {
    id: 0,
    stemID: 0,
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
    speciesIDLevel: '',
    speciesFieldFamily: ''
  };
  const [refresh, setRefresh] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const { data: session } = useSession();

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3, width: '100%' }}>
        <Box
          sx={{
            width: '100%',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: 'warning.main',
            borderRadius: '4px',
            p: 2
          }}
        >
          <Box sx={{ flexGrow: 1 }}>
            {session?.user.userStatus !== 'field crew' && (
              <Typography level={'title-lg'} sx={{ color: '#ffa726' }}>
                Note: ADMINISTRATOR VIEW
              </Typography>
            )}
          </Box>

          {/* Upload Button */}
          <Button onClick={() => setIsUploadModalOpen(true)} variant="solid" color="primary">
            Upload
          </Button>
        </Box>
      </Box>

      <UploadParentModal
        isUploadModalOpen={isUploadModalOpen}
        handleCloseUploadModal={() => {
          setIsUploadModalOpen(false);
          setRefresh(true);
        }}
        formType={FormType.species}
      />

      <IsolatedDataGridCommons
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
      />
    </>
  );
}
