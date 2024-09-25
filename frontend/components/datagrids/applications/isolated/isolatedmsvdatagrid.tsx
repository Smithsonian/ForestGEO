'use client';

import { MeasurementsSummaryDraftRDS } from '@/config/sqlrdsdefinitions/views';
import { useOrgCensusContext, usePlotContext } from '@/app/contexts/userselectionprovider';
import React, { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Box, Button, Typography } from '@mui/joy';
import Link from 'next/link';
import UploadParentModal from '@/components/uploadsystemhelpers/uploadparentmodal';
import { FormType } from '@/config/macros/formdetails';
import IsolatedDataGridCommons from '@/components/datagrids/isolateddatagridcommons';
import { quadratGridColumns } from '@/components/client/datagridcolumns';

export default function MeasurementsSummaryDraftDataGrid() {
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const initialMeasurementsSummaryDraftRDSRow: MeasurementsSummaryDraftRDS = {
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
    stemUnits: '',
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
            Upload Quadrats
          </Button>
          {/* Link to Quadrat Personnel Data Grid */}
          <Link href="/fixeddatainput/quadratpersonnel" passHref>
            <Button variant="solid" color="primary" sx={{ ml: 2 }}>
              View Quadrat Personnel
            </Button>
          </Link>
        </Box>
      </Box>
      <UploadParentModal
        isUploadModalOpen={isUploadModalOpen}
        handleCloseUploadModal={() => {
          setIsUploadModalOpen(false);
          setRefresh(true);
        }}
        formType={FormType.quadrats}
      />
      <IsolatedDataGridCommons
        gridType="measurementssummary_draft"
        gridColumns={quadratGridColumns}
        refresh={refresh}
        setRefresh={setRefresh}
        initialRow={initialMeasurementsSummaryDraftRDSRow}
        fieldToFocus={'quadratName'}
        clusters={{
          Name: ['quadratName'],
          Coordinates: ['startX', 'startY', 'coordinateUnits'],
          Dimensions: ['dimensionX', 'dimensionY', 'dimensionUnits'],
          Area: ['area', 'areaUnits'],
          Misc: ['quadratShape']
        }}
      />
    </>
  );
}
