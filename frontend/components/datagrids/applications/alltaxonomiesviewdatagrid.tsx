// alltaxonomiesview datagrid
'use client';
import { GridColDef, GridRenderEditCellParams, GridRowsProp } from '@mui/x-data-grid';
import { AlertProps } from '@mui/material';
import React, { useEffect, useState } from 'react';
import { randomId } from '@mui/x-data-grid-generator';
import DataGridCommons from '@/components/datagrids/datagridcommons';
import { Box, Button, DialogContent, DialogTitle, Modal, ModalClose, ModalDialog, Typography } from '@mui/joy';
import { useSession } from 'next-auth/react';
import UploadParentModal from '@/components/uploadsystemhelpers/uploadparentmodal';
import { FormType } from '@/config/macros/formdetails';
import { AllTaxonomiesViewRDS } from '@/config/sqlrdsdefinitions/views';
import { formatHeader } from '@/components/client/datagridcolumns';
import { SpeciesLimitsRDS, SpeciesRDS } from '@/config/sqlrdsdefinitions/taxonomies';
import { useSiteContext } from '@/app/contexts/userselectionprovider';
import SpeciesLimitsDataGrid from '@/components/datagrids/applications/specieslimitsdatagrid';

export default function AllTaxonomiesViewDataGrid() {
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
    fieldFamily: '',
    description: ''
  };
  const [rows, setRows] = useState([initialAllTaxonomiesViewRDSRow] as GridRowsProp);
  const [rowCount, setRowCount] = useState(0);
  const [rowModesModel, setRowModesModel] = useState({});
  const [snackbar, setSnackbar] = React.useState<Pick<AlertProps, 'children' | 'severity'> | null>(null);
  const [refresh, setRefresh] = useState(false);
  const [paginationModel, setPaginationModel] = useState({
    page: 0,
    pageSize: 10
  });
  const [isNewRowAdded, setIsNewRowAdded] = useState(false);
  const [shouldAddRowAfterFetch, setShouldAddRowAfterFetch] = useState(false);
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

  const addNewRowToGrid = () => {
    const id = randomId();
    const newRow = {
      ...initialAllTaxonomiesViewRDSRow,
      id,
      isNew: true
    };

    setRows(oldRows => [...(oldRows ?? []), newRow]);
    setRowModesModel(oldModel => ({
      ...oldModel,
      [id]: { mode: 'edit', fieldToFocus: 'speciesCode' }
    }));
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
      editable: true
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
      editable: true
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

      <DataGridCommons
        gridType="alltaxonomiesview"
        gridColumns={AllTaxonomiesViewGridColumns}
        rows={rows}
        setRows={setRows}
        rowCount={rowCount}
        setRowCount={setRowCount}
        rowModesModel={rowModesModel}
        setRowModesModel={setRowModesModel}
        snackbar={snackbar}
        setSnackbar={setSnackbar}
        refresh={refresh}
        setRefresh={setRefresh}
        paginationModel={paginationModel}
        setPaginationModel={setPaginationModel}
        isNewRowAdded={isNewRowAdded}
        setIsNewRowAdded={setIsNewRowAdded}
        shouldAddRowAfterFetch={shouldAddRowAfterFetch}
        setShouldAddRowAfterFetch={setShouldAddRowAfterFetch}
        addNewRowToGrid={addNewRowToGrid}
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
