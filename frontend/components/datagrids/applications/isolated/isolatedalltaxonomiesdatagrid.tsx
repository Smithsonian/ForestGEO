// alltaxonomiesview datagrid
'use client';
import { GridColDef, GridRenderEditCellParams } from '@mui/x-data-grid';
import React, { useEffect, useState } from 'react';
import { Box, Button } from '@mui/joy';
import UploadParentModal from '@/components/uploadsystemhelpers/uploadparentmodal';
import { FormType } from '@/config/macros/formdetails';
import { AllTaxonomiesViewRDS } from '@/config/sqlrdsdefinitions/views';
import { formatHeader } from '@/components/client/datagridcolumns';
import { SpeciesLimitsRDS, SpeciesRDS } from '@/config/sqlrdsdefinitions/taxonomies';
import IsolatedDataGridCommons from '@/components/datagrids/isolateddatagridcommons';
import MultilineModal from '@/components/datagrids/applications/multiline/multilinemodal';
import { standardizeGridColumns } from '@/components/client/clientmacros';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import HighlightOffIcon from '@mui/icons-material/HighlightOff';
import SpeciesLimitsModal from '@/components/client/specieslimitsmodal';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';

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

    if (allSpeciesLimits.length === 0 || refresh) fetchLimits().catch(console.error); // get all of them asap
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

  const AllTaxonomiesViewGridColumns: GridColDef[] = standardizeGridColumns([
    {
      field: 'id',
      headerName: '#',
      flex: 0.3,
      editable: false
    },
    {
      field: 'speciesID',
      headerName: '#',
      flex: 0.5,
      type: 'number',
      editable: false
    },
    {
      field: 'speciesCode',
      headerName: 'Species Code',
      renderHeader: () => formatHeader('Species', 'Code'),
      flex: 0.5,
      type: 'string',
      editable: true
    },
    {
      field: 'familyID',
      headerName: 'Family ID',
      flex: 0,
      type: 'number',
      editable: false
    },
    {
      field: 'family',
      headerName: 'Family',
      flex: 1,
      type: 'string',
      editable: true
    },
    {
      field: 'genusID',
      headerName: 'Genus ID',
      flex: 1,
      type: 'number',
      editable: false
    },
    {
      field: 'genus',
      headerName: 'Genus',
      flex: 0.75,
      type: 'string',
      editable: true
    },
    {
      field: 'genusAuthority',
      headerName: 'Genus Auth',
      renderHeader: () => formatHeader('Genus', 'Authority'),
      flex: 0.75,
      type: 'string',
      editable: true
    },
    {
      field: 'speciesName',
      headerName: 'Species',
      renderHeader: () => formatHeader('Species', 'Name'),
      flex: 0.75,
      type: 'string',
      editable: true
    },
    {
      field: 'subspeciesName',
      headerName: 'Subspecies',
      renderHeader: () => formatHeader('Subspecies', 'Name'),
      flex: 1,
      type: 'string',
      editable: true
    },
    {
      field: 'speciesidLevel',
      headerName: 'Species ID Level',
      renderHeader: () => formatHeader('Species', 'ID Level'),
      flex: 1,
      type: 'string',
      editable: true
    },
    {
      field: 'speciesAuthority',
      headerName: 'Species Auth',
      renderHeader: () => formatHeader('Species', 'Authority'),
      flex: 1,
      type: 'string',
      editable: true
    },
    {
      field: 'subspeciesAuthority',
      headerName: 'Subspecies Auth',
      renderHeader: () => formatHeader('Subspecies', 'Authority'),
      flex: 1,
      type: 'string',
      editable: true
    },
    {
      field: 'fieldFamily',
      headerName: 'Field Family',
      renderHeader: () => formatHeader('Field', 'Family'),
      flex: 1,
      type: 'string',
      editable: true
    },
    {
      field: 'validCode',
      headerName: 'Valid Code',
      renderHeader: () => formatHeader('Valid', 'Code'),
      flex: 1,
      type: 'string',
      editable: true
    },
    {
      field: 'speciesDescription',
      headerName: 'Species Description',
      renderHeader: () => formatHeader('Species', 'Description'),
      flex: 1,
      type: 'string',
      editable: true
    },
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
  ]);

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
        gridType="alltaxonomiesview"
        gridColumns={AllTaxonomiesViewGridColumns}
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
