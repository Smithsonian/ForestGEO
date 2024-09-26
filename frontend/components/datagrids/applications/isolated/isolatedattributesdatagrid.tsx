'use client';

// isolated attributes datagrid
import React, { useState } from 'react';
import { Box, Button, Typography } from '@mui/joy';
import { useSession } from 'next-auth/react';
import UploadParentModal from '@/components/uploadsystemhelpers/uploadparentmodal';
import { AttributeGridColumns } from '@/components/client/datagridcolumns';
import { FormType } from '@/config/macros/formdetails';
import IsolatedDataGridCommons from '@/components/datagrids/isolateddatagridcommons';

export default function IsolatedAttributesDataGrid() {
  const initialAttributesRDSRow = {
    id: 0,
    code: '',
    description: '',
    status: ''
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
        formType={FormType.attributes}
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
      />
    </>
  );
}
