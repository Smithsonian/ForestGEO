// alltaxonomiesview datagrid
'use client';
import { GridRenderEditCellParams } from '@mui/x-data-grid';
import React, { useEffect, useMemo, useState } from 'react';
import { Box, Button } from '@mui/joy';
import UploadParentModal from '@/components/uploadsystemhelpers/uploadparentmodal';
import { FormType } from '@/config/macros/formdetails';
import { AllTaxonomiesViewRDS } from '@/config/sqlrdsdefinitions/views';
import { AllTaxonomiesViewGridColumns, formatHeader } from '@/components/client/datagridcolumns';
import { SpeciesLimitsRDS, SpeciesRDS } from '@/config/sqlrdsdefinitions/taxonomies';
import IsolatedDataGridCommons from '@/components/datagrids/isolateddatagridcommons';
import MultilineModal from '@/components/datagrids/applications/multiline/multilinemodal';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import HighlightOffIcon from '@mui/icons-material/HighlightOff';
import SpeciesLimitsModal from '@/components/client/modals/specieslimitsmodal';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import ailogger from '@/ailogger';

export default function IsolatedAllTaxonomiesViewDataGrid() {
  const initialAllTaxonomiesViewRDSRow: AllTaxonomiesViewRDS = {
    id: 0,
    familyID: 0,
    genusID: 0,
    speciesID: 0,
    family: '',
    genus: '',
    genusAuthority: '',
    speciesCode: '',
    speciesName: '',
    subspeciesName: '',
    idLevel: '',
    speciesAuthority: '',
    subspeciesAuthority: '',
    validCode: '',
    fieldFamily: '',
    description: ''
  };
  const [refresh, setRefresh] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isManualEntryFormOpen, setIsManualEntryFormOpen] = useState(false);
  const [isSpeciesLimitsDialogOpen, setIsSpeciesLimitsDialogOpen] = useState(false);
  const [selectedSpeciesRow, setSelectedSpeciesRow] = useState<SpeciesRDS | null>(null);
  const [allSpeciesLimits, setAllSpeciesLimits] = useState<SpeciesLimitsRDS[]>([]);
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();

  useEffect(() => {
    async function fetchLimits() {
      const response = await fetch(`/api/specieslimits/${currentPlot?.plotID}/${currentCensus?.plotCensusNumber}?schema=${currentSite?.schemaName}`, {
        method: 'GET'
      });
      setAllSpeciesLimits(await response.json());
    }

    if (allSpeciesLimits.length === 0 || refresh) fetchLimits().catch(ailogger.error);
  }, [refresh]);

  const handleOpenSpeciesLimitsModal = (speciesRow: SpeciesRDS) => {
    setSelectedSpeciesRow(speciesRow);
    setIsSpeciesLimitsDialogOpen(true);
  };

  const handleCloseSpeciesLimitsModal = () => {
    setIsSpeciesLimitsDialogOpen(false);
    setSelectedSpeciesRow(null);
  };

  async function resetTables() {
    await fetch(`/api/clearatv?schema=${currentSite?.schemaName ?? ''}`);
  }

  const renderSpeciesLimitsCell = (params: GridRenderEditCellParams) => {
    const speciesLimits = allSpeciesLimits.find(limit => limit.speciesID === params.row.speciesID);
    const hasLimits = speciesLimits !== undefined && speciesLimits.upperBound !== undefined && speciesLimits.lowerBound !== undefined;
    return (
      <Box sx={{ height: '100%', width: '100%' }}>
        <Button
          variant={'plain'}
          startDecorator={hasLimits ? <CheckCircleOutlineIcon color="success" /> : <HighlightOffIcon color="warning" />}
          onClick={() => handleOpenSpeciesLimitsModal(params.row as SpeciesRDS)}
          sx={{
            display: 'flex',
            justifyContent: 'flex-start',
            gap: 1,
            padding: '0.5em 1em',
            textTransform: 'none',
            width: '100%'
          }}
        >
          <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'center' }}>
            {hasLimits ? formatHeader('Modify', 'Species Limits') : formatHeader('Add', 'Species Limits')}
          </Box>
        </Button>
      </Box>
    );
  };

  const columns = useMemo(() => {
    return [
      ...AllTaxonomiesViewGridColumns,
      {
        field: 'speciesLimits',
        headerName: 'Species Limits',
        renderHeader: () => formatHeader('Species', 'Limits'),
        flex: 1,
        renderCell: renderSpeciesLimitsCell,
        editable: false,
        sortable: false,
        filterable: false
      }
    ];
  }, [AllTaxonomiesViewGridColumns]);

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

      <MultilineModal
        isManualEntryFormOpen={isManualEntryFormOpen}
        handleCloseManualEntryForm={() => {
          setIsManualEntryFormOpen(false);
          setRefresh(true);
        }}
        formType={'species'}
      />

      <IsolatedDataGridCommons
        defaultHideEmpty
        gridType="alltaxonomiesview"
        gridColumns={columns}
        refresh={refresh}
        setRefresh={setRefresh}
        initialRow={initialAllTaxonomiesViewRDSRow}
        fieldToFocus={'speciesCode'}
        clusters={{
          Family: ['family'],
          Genus: ['genus', 'genusAuthority'],
          Species: ['speciesCode', 'speciesName', 'speciesIDLevel', 'speciesAuthority', 'fieldFamily', 'validCode', 'speciesDescription'],
          Subspecies: ['subspeciesName', 'subspeciesAuthority']
        }}
        dynamicButtons={[
          { label: 'Manual Entry Form', onClick: () => setIsManualEntryFormOpen(true), tooltip: 'Submit data by filling out a form' },
          { label: 'Upload', onClick: () => setIsUploadModalOpen(true), tooltip: 'Submit data by uploading a CSV file' },
          {
            label: 'RESET Table',
            onClick: async () => {
              await fetch(`/api/clearatv?schema=${currentSite?.schemaName ?? ''}`);
              setRefresh(true);
            },
            tooltip: 'Reset all species-related tables!'
          }
        ]}
      />
      {selectedSpeciesRow && (
        <SpeciesLimitsModal
          openSpeciesLimitsModal={isSpeciesLimitsDialogOpen}
          handleCloseSpeciesLimitsModal={handleCloseSpeciesLimitsModal}
          incomingSpecies={selectedSpeciesRow}
          allSpeciesLimits={allSpeciesLimits}
          setRefresh={setRefresh}
        />
      )}
    </>
  );
}
