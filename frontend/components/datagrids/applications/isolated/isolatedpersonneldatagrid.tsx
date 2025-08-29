// personnel datagrid
'use client';
import { GridColDef, GridRenderCellParams } from '@mui/x-data-grid';
import React, { useEffect, useRef, useState } from 'react';
import { Box, Checkbox, Chip, IconButton, Modal, ModalDialog, Typography } from '@mui/joy';
import UploadParentModal from '@/components/uploadsystemhelpers/uploadparentmodal';
import { FormType } from '@/config/macros/formdetails';
import { formatHeader, PersonnelGridColumns } from '@/components/client/datagridcolumns';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import CloseIcon from '@mui/icons-material/Close';
import { PersonnelRDS, RoleRDS } from '@/config/sqlrdsdefinitions/personnel';
import IsolatedDataGridCommons, { IsolatedDataGridCommonsHandle } from '@/components/datagrids/isolateddatagridcommons';
import IsolatedRolesDataGrid from '@/components/datagrids/applications/isolated/isolatedrolesdatagrid';
import MultilineModal from '@/components/datagrids/applications/multiline/multilinemodal';
import ailogger from '@/ailogger';

export default function IsolatedPersonnelDataGrid() {
  const dataGridRef = useRef<IsolatedDataGridCommonsHandle>(null);
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const initialPersonnelRDSRow: PersonnelRDS = {
    id: 0,
    personnelID: 0,
    firstName: '',
    lastName: '',
    roleID: 0,
    censusActive: false
  };
  const [refresh, setRefresh] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isManualEntryFormOpen, setIsManualEntryFormOpen] = useState(false);
  const [isRolesModalOpen, setIsRolesModalOpen] = useState(false);
  const [roles, setRoles] = useState<RoleRDS[]>([]);

  useEffect(() => {
    async function fetchRoles() {
      const response = await fetch(`/api/fetchall/roles/${currentPlot?.plotID ?? 0}/${currentCensus?.plotCensusNumber ?? 0}?schema=${currentSite?.schemaName}`);
      setRoles(await response.json());
    }

    fetchRoles().catch(ailogger.error);
  }, [refresh]);

  const roleIDColumn: GridColDef = {
    field: 'roleID',
    headerName: 'Role',
    headerClassName: 'header',
    headerAlign: 'center',
    type: 'singleSelect',
    flex: 1,
    align: 'center',
    editable: true,
    valueOptions: roles.map(role => ({
      value: role.roleID,
      label: `${role.roleName}`
    })),
    renderCell: (params: GridRenderCellParams) => (
      <Box
        sx={{
          display: 'flex',
          flex: 1,
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          width: '100%',
          height: '100%'
        }}
      >
        <Chip variant={'soft'} color={'primary'}>
          <Typography level="body-sm">{roles.find(role => role.roleID === params.value)?.roleName || 'No Role'}</Typography>
        </Chip>
      </Box>
    )
  };

  const isPersonActive: GridColDef = {
    field: 'censusActive',
    headerName: 'CensusActive',
    renderHeader: () => formatHeader('Census', 'Active'),
    headerAlign: 'center',
    type: 'boolean',
    flex: 0.25,
    align: 'center',
    editable: false,
    renderCell: (params: GridRenderCellParams) => {
      const handleToggle = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const updatedRow = { ...params.row, censusActive: event.target.checked };
        try {
          await dataGridRef.current?.updateRow(updatedRow, params.row);
          dataGridRef.current?.showSnackbar('Census Active status updated!', 'success');
        } catch (err: any) {
          dataGridRef.current?.showSnackbar(`Error: ${err.message}`, 'error');
        } finally {
          await dataGridRef.current?.fetchPaginatedData();
        }
      };

      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%' }}>
          <Checkbox
            aria-label={'toggle person as active/inactive in that census'}
            checked={!!params.value}
            onChange={async e => {
              e.stopPropagation();
              await handleToggle(e);
            }}
            style={{ cursor: 'pointer' }}
          />
        </Box>
      );
    }
  };

  return (
    <>
      <UploadParentModal
        isUploadModalOpen={isUploadModalOpen}
        handleCloseUploadModal={() => {
          setIsUploadModalOpen(false);
          setRefresh(true);
        }}
        formType={FormType.personnel}
      />
      <MultilineModal
        isManualEntryFormOpen={isManualEntryFormOpen}
        handleCloseManualEntryForm={() => {
          setIsManualEntryFormOpen(false);
          setRefresh(true);
        }}
        formType={'personnel'}
      />
      <Modal
        open={isRolesModalOpen}
        onClose={() => setIsRolesModalOpen(false)}
        aria-labelledby="roles-dialog-modal"
        sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <ModalDialog size="lg" sx={{ maxWidth: '100vh', maxHeight: '100vh', overflow: 'auto' }} role="alertdialog">
          <IconButton aria-label="close" onClick={() => setIsRolesModalOpen(false)} sx={{ position: 'absolute', top: 8, right: 8 }}>
            <CloseIcon />
          </IconButton>
          <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column', width: '100%' }}>
            <IsolatedRolesDataGrid
              onRolesUpdated={async () => {
                // This triggers the personnel grid to refresh
                setRefresh(true);
              }}
            />
          </Box>
        </ModalDialog>
      </Modal>
      <IsolatedDataGridCommons
        ref={dataGridRef}
        gridType="personnel"
        gridColumns={[...PersonnelGridColumns, roleIDColumn, isPersonActive]}
        refresh={refresh}
        setRefresh={setRefresh}
        selectionOptions={roles.map(role => ({
          value: role.roleID ?? 0,
          label: `${role.roleName}`
        }))}
        initialRow={initialPersonnelRDSRow}
        fieldToFocus={'firstName'}
        clusters={{
          Name: ['firstName', 'lastName'],
          Role: ['roleID']
        }}
        dynamicButtons={[
          { label: 'Manual Entry Form', onClick: () => setIsManualEntryFormOpen(true), tooltip: 'Submit data by filling out a form' },
          { label: 'Upload', onClick: () => setIsUploadModalOpen(true), tooltip: 'Submit data by uploading a CSV file' },
          { label: 'Edit Roles', onClick: () => setIsRolesModalOpen(true), tooltip: 'Edit roles for personnel' }
        ]}
      />
    </>
  );
}
