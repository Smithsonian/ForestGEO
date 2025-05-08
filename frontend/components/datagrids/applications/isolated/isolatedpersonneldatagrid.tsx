// personnel datagrid
'use client';
import { GridColDef, GridRenderCellParams } from '@mui/x-data-grid';
import React, { useEffect, useState } from 'react';
import { Box, Chip, IconButton, Modal, ModalDialog, Typography } from '@mui/joy';
import UploadParentModal from '@/components/uploadsystemhelpers/uploadparentmodal';
import { FormType } from '@/config/macros/formdetails';
import { PersonnelGridColumns } from '@/components/client/datagridcolumns';
import { useSiteContext } from '@/app/contexts/userselectionprovider';
import CloseIcon from '@mui/icons-material/Close';
import { PersonnelRDS, RoleRDS } from '@/config/sqlrdsdefinitions/personnel';
import IsolatedDataGridCommons from '@/components/datagrids/isolateddatagridcommons';
import IsolatedRolesDataGrid from '@/components/datagrids/applications/isolated/isolatedrolesdatagrid';
import MultilineModal from '@/components/datagrids/applications/multiline/multilinemodal';

export default function IsolatedPersonnelDataGrid() {
  const currentSite = useSiteContext();
  const initialPersonnelRDSRow: PersonnelRDS = {
    id: 0,
    personnelID: 0,
    firstName: '',
    lastName: '',
    roleID: 0
  };
  const [refresh, setRefresh] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isManualEntryFormOpen, setIsManualEntryFormOpen] = useState(false);
  const [isRolesModalOpen, setIsRolesModalOpen] = useState(false);
  const [roles, setRoles] = useState<RoleRDS[]>([]);

  useEffect(() => {
    async function fetchRoles() {
      const response = await fetch(`/api/fetchall/roles?schema=${currentSite?.schemaName}`);
      setRoles(await response.json());
    }

    fetchRoles().catch(console.error);
  }, [refresh]);

  const roleIDColumn: GridColDef = {
    field: 'roleID',
    headerName: 'Role',
    headerClassName: 'header',
    headerAlign: 'left',
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
          <Typography level="body-sm">{roles.find(role => role.roleID === params.value)?.roleName}</Typography>
        </Chip>
      </Box>
    )
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
        gridType="personnel"
        gridColumns={[...PersonnelGridColumns, roleIDColumn]}
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
