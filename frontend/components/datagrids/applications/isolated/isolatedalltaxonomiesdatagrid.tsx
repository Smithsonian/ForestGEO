// alltaxonomiesview datagrid
'use client';
import { GridColDef, GridRenderEditCellParams } from '@mui/x-data-grid';
import React, { useEffect, useState } from 'react';
import { Box, Button, DialogContent, DialogTitle, Modal, ModalClose, ModalDialog, Typography } from '@mui/joy';
import { useSession } from 'next-auth/react';
import UploadParentModal from '@/components/uploadsystemhelpers/uploadparentmodal';
import { FormType } from '@/config/macros/formdetails';
import { AllTaxonomiesViewRDS } from '@/config/sqlrdsdefinitions/views';
import { formatHeader } from '@/components/client/datagridcolumns';
import { SpeciesLimitsRDS, SpeciesRDS } from '@/config/sqlrdsdefinitions/taxonomies';
import { useSiteContext } from '@/app/contexts/userselectionprovider';
import SpeciesLimitsDataGrid from '@/components/datagrids/applications/specieslimitsdatagrid';
import IsolatedDataGridCommons from '@/components/datagrids/isolateddatagridcommons';

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
  const { data: session } = useSession();
  const [isSpeciesLimitsDialogOpen, setIsSpeciesLimitsDialogOpen] = useState(false);
  const [selectedSpeciesRow, setSelectedSpeciesRow] = useState<SpeciesRDS | null>(null);
  const [selectedSpeciesLimits, setSelectedSpeciesLimits] = useState<SpeciesLimitsRDS[]>([]);
  const currentSite = useSiteContext();

  useEffect(() => {
    async function fetchLimits() {
      if (selectedSpeciesRow && currentSite?.schemaName) {
        const response = await fetch(`/api/specieslimits/${selectedSpeciesRow.speciesID}?schema=${currentSite.schemaName}`, { method: 'GET' });
        setSelectedSpeciesLimits(await response.json());
      }
    }

    fetchLimits().catch(console.error);
  }, [selectedSpeciesRow]);

  const handleOpenSpeciesLimitsModal = (speciesRow: SpeciesRDS) => {
    setSelectedSpeciesRow(speciesRow);
    setIsSpeciesLimitsDialogOpen(true);
  };

  const handleCloseSpeciesLimitsModal = () => {
    setIsSpeciesLimitsDialogOpen(false);
    setSelectedSpeciesRow(null);
  };

  const renderSpeciesLimitsCell = (params: GridRenderEditCellParams) => {
    const lowerBound = params.row.lowerBound !== undefined ? Number(params.row.lowerBound).toFixed(2) : 'Lower';
    const upperBound = params.row.upperBound !== undefined ? Number(params.row.upperBound).toFixed(2) : 'Upper';
    const unit = params.row.unit || '';

    return (
      <Box sx={{ display: 'flex', height: '100%', width: '100%', padding: '0.5em' }}>
        <Button
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5em',
            width: '100%',
            height: '100%'
          }}
          onClick={() => {}} // handleOpenSpeciesLimitsModal(params.row as SpeciesRDS)}
        >
          {lowerBound} {unit}
          <Box sx={{ borderLeft: '1px solid', height: '1em', mx: 1 }} />
          {upperBound} {unit}
        </Button>
      </Box>
    );
  };

  const AllTaxonomiesViewGridColumns: GridColDef[] = [
    {
      field: 'id',
      headerName: '#',
      headerClassName: 'header',
      flex: 0.3,
      align: 'right',
      headerAlign: 'right',
      editable: false
    },
    {
      field: 'speciesID',
      headerName: '#',
      headerClassName: 'header',
      flex: 0.5,
      align: 'center',
      headerAlign: 'center',
      type: 'number',
      editable: false
    },
    {
      field: 'speciesCode',
      headerName: 'Species Code',
      renderHeader: () => formatHeader('Species', 'Code'),
      headerClassName: 'header',
      flex: 1,
      align: 'center',
      headerAlign: 'center',
      type: 'string',
      editable: true
    },
    {
      field: 'familyID',
      headerName: 'Family ID',
      headerClassName: 'header',
      flex: 1,
      align: 'center',
      headerAlign: 'center',
      type: 'number',
      editable: false
    },
    {
      field: 'family',
      headerName: 'Family',
      headerClassName: 'header',
      flex: 1,
      align: 'center',
      headerAlign: 'center',
      type: 'string',
      editable: true
    },
    {
      field: 'genusID',
      headerName: 'Genus ID',
      headerClassName: 'header',
      flex: 1,
      align: 'center',
      headerAlign: 'center',
      type: 'number',
      editable: false
    },
    {
      field: 'genus',
      headerName: 'Genus',
      headerClassName: 'header',
      flex: 1,
      align: 'center',
      headerAlign: 'center',
      type: 'string',
      editable: true
    },
    {
      field: 'genusAuthority',
      headerName: 'Genus Auth',
      renderHeader: () => formatHeader('Genus', 'Authority'),
      headerClassName: 'header',
      flex: 1,
      align: 'center',
      headerAlign: 'center',
      type: 'string',
      editable: true
    },
    {
      field: 'speciesName',
      headerName: 'Species',
      headerClassName: 'header',
      renderHeader: () => formatHeader('Species', 'Name'),
      flex: 1,
      align: 'center',
      headerAlign: 'center',
      type: 'string',
      editable: true
    },
    {
      field: 'subspeciesName',
      headerName: 'Subspecies',
      headerClassName: 'header',
      renderHeader: () => formatHeader('Subspecies', 'Name'),
      flex: 1,
      align: 'center',
      headerAlign: 'center',
      type: 'string',
      editable: true
    },
    {
      field: 'speciesIDLevel',
      headerName: 'Species ID Level',
      renderHeader: () => formatHeader('Species', 'ID Level'),
      headerClassName: 'header',
      flex: 1,
      align: 'center',
      headerAlign: 'center',
      type: 'string',
      editable: true
    },
    {
      field: 'speciesAuthority',
      headerName: 'Species Auth',
      renderHeader: () => formatHeader('Species', 'Authority'),
      headerClassName: 'header',
      flex: 1,
      align: 'center',
      headerAlign: 'center',
      type: 'string',
      editable: true
    },
    {
      field: 'subspeciesAuthority',
      headerName: 'Subspecies Auth',
      renderHeader: () => formatHeader('Subspecies', 'Authority'),
      headerClassName: 'header',
      flex: 1,
      align: 'center',
      headerAlign: 'center',
      type: 'string',
      editable: true
    },
    {
      field: 'fieldFamily',
      headerName: 'Field Family',
      renderHeader: () => formatHeader('Field', 'Family'),
      headerClassName: 'header',
      flex: 1,
      align: 'center',
      headerAlign: 'center',
      type: 'string',
      editable: true
    },
    {
      field: 'validCode',
      headerName: 'Valid Code',
      renderHeader: () => formatHeader('Valid', 'Code'),
      headerClassName: 'header',
      flex: 1,
      align: 'center',
      headerAlign: 'center',
      type: 'string',
      editable: true
    },
    {
      field: 'speciesDescription',
      headerName: 'Species Description',
      renderHeader: () => formatHeader('Species', 'Description'),
      headerClassName: 'header',
      flex: 1,
      align: 'center',
      headerAlign: 'center',
      type: 'string',
      editable: true
    },
    {
      field: 'speciesLimits',
      headerName: 'Species Limits',
      flex: 1,
      align: 'center',
      renderCell: renderSpeciesLimitsCell,
      editable: false,
      sortable: false,
      filterable: false
    }
  ];

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
      />

      <Modal open={isSpeciesLimitsDialogOpen} onClose={() => {}} sx={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ModalDialog size="lg" role="alertdialog">
          <ModalClose onClick={handleCloseSpeciesLimitsModal} />
          <DialogTitle>Species Limits Test</DialogTitle>
          <DialogContent>
            {selectedSpeciesRow && selectedSpeciesRow.speciesID && <SpeciesLimitsDataGrid speciesID={selectedSpeciesRow.speciesID} />}
          </DialogContent>
        </ModalDialog>
      </Modal>
    </>
  );
}
