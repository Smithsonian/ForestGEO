'use client';

import { MeasurementsSummaryStagingRDS } from '@/config/sqlrdsdefinitions/views';
import { useOrgCensusContext, usePlotContext } from '@/app/contexts/userselectionprovider';
import React, { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Box, Button, Typography } from '@mui/joy';
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
    localX: 0,
    localY: 0,
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
  const { data: session } = useSession();
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

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
            <Typography level={'title-md'} sx={{ color: '#ffa726' }}>
              Note: This is a locked view and will not allow modification.
            </Typography>
            <Typography level={'body-md'} sx={{ color: '#ffa726' }}>
              Please use this view as a way to confirm changes made to measurements.
            </Typography>
          </Box>

          {/* Upload Button */}
          <Button
            onClick={() => {
              setIsUploadModalOpen(true);
            }}
            color={'primary'}
          >
            Upload Measurements
          </Button>
        </Box>
      </Box>
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
      />
    </>
  );
}
