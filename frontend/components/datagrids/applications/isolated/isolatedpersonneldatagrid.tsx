// personnel datagrid
'use client';
import { GridColDef, GridRenderCellParams } from '@mui/x-data-grid';
import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Box, Button, Chip, IconButton, Modal, ModalDialog, Stack, Typography } from '@mui/joy';
import UploadParentModal from '@/components/uploadsystemhelpers/uploadparentmodal';
import Link from 'next/link';
import { FormType } from '@/config/macros/formdetails';
import { PersonnelGridColumns } from '@/components/client/datagridcolumns';
import { useOrgCensusContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import CloseIcon from '@mui/icons-material/Close';
import { PersonnelRDS, RoleRDS } from '@/config/sqlrdsdefinitions/personnel';
import IsolatedDataGridCommons from '@/components/datagrids/isolateddatagridcommons';
import IsolatedRolesDataGrid from '@/components/datagrids/applications/isolated/isolatedrolesdatagrid';
import MultilineModal from '@/components/datagrids/applications/multiline/multilinemodal';

export default function IsolatedPersonnelDataGrid() {
  const currentSite = useSiteContext();
  const currentCensus = useOrgCensusContext();
  const initialPersonnelRDSRow: PersonnelRDS = {
    id: 0,
    personnelID: 0,
    censusID: currentCensus?.dateRanges[0]?.censusID,
    firstName: '',
    lastName: '',
    roleID: 0
  };
  const [refresh, setRefresh] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isManualEntryFormOpen, setIsManualEntryFormOpen] = useState(false);
  const [isRolesModalOpen, setIsRolesModalOpen] = useState(false);
  const [roles, setRoles] = useState<RoleRDS[]>([]);
  const { data: session } = useSession();

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

          <Stack direction="column" spacing={2}>
            <Stack direction={'row'} spacing={2}>
              <Button onClick={() => setIsManualEntryFormOpen(true)} variant={'solid'} color={'primary'}>
                Manual Entry Form
              </Button>
              <Button onClick={() => setIsUploadModalOpen(true)} variant="solid" color="primary">
                Upload
              </Button>
            </Stack>
            <Link href="/fixeddatainput/quadratpersonnel" passHref>
              <Button variant="solid" color="primary" sx={{ ml: 2 }}>
                View Quadrat Personnel
              </Button>
            </Link>
            <Button onClick={() => setIsRolesModalOpen(true)} variant={'solid'} color={'primary'}>
              Edit Roles
            </Button>
          </Stack>
        </Box>
      </Box>

      <UploadParentModal
        isUploadModalOpen={isUploadModalOpen}
        handleCloseUploadModal={() => {
          setIsUploadModalOpen(false);
          setRefresh(true);
        }}
        formType={FormType.personnel}
      />
      <MultilineModal isManualEntryFormOpen={isManualEntryFormOpen} handleCloseManualEntryForm={() => setIsManualEntryFormOpen(false)} formType={'personnel'} />
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
              onRolesUpdated={() => {
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
      />
    </>
  );
}
