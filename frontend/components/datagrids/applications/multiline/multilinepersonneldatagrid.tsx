'use client';

import React, { useEffect, useState } from 'react';
import IsolatedMultilineDataGridCommons from '@/components/datagrids/isolatedmultilinedatagridcommons';
import { PersonnelFormGridColumns } from '@/components/client/formcolumns';
import { DataGridSignals, FormType } from '@/config/macros/formdetails';
import { Autocomplete, AutocompleteOption, Box, createFilterOptions, ListItemDecorator } from '@mui/joy';
import RenderFormExplanations from '@/components/client/renderformexplanations';
import { useSiteContext } from '@/app/contexts/userselectionprovider';
import { RoleRDS } from '@/config/sqlrdsdefinitions/personnel';
import { standardizeGridColumns } from '@/components/client/clientmacros';
import { GridRenderEditCellParams } from '@mui/x-data-grid';
import { Add } from '@mui/icons-material';

export default function MultilinePersonnelDataGrid(props: DataGridSignals) {
  type ExtendedRoleRDS = RoleRDS & {
    inputValue?: string;
  };
  const { setChangesSubmitted } = props;
  const initialPersonnelRow = {
    id: 0,
    firstname: '',
    lastname: '',
    role: '',
    roledescription: ''
  };
  const [refresh, setRefresh] = useState(false);
  const currentSite = useSiteContext();
  const [storedRoles, setStoredRoles] = useState<RoleRDS[]>([]);
  const [selectedRole, setSelectedRole] = useState<ExtendedRoleRDS | null>(null);

  useEffect(() => {
    async function getRoles() {
      setStoredRoles(await (await fetch(`/api/fetchall/roles?schema=${currentSite?.schemaName}`)).json());
    }

    getRoles().catch(console.error);
  }, []);

  const filter = createFilterOptions<ExtendedRoleRDS>();
  const roleColumns = standardizeGridColumns([
    {
      field: 'role',
      headerName: 'Role',
      flex: 1,
      editable: true,
      renderEditCell: (params: GridRenderEditCellParams) => (
        <Autocomplete
          value={selectedRole}
          onChange={(event, newValue: any) => {
            if (typeof newValue === 'string') {
              params.api.setEditCellValue({ id: params.id, field: 'role', value: newValue });
              params.api.setEditCellValue({
                id: params.id,
                field: 'roledescription',
                value: storedRoles.find(role => role.roleName === newValue)?.roleDescription ?? ''
              });
              setSelectedRole({
                roleName: newValue
              });
            } else if (newValue && newValue.inputValue) {
              // Create a new value from the user input
              params.api.setEditCellValue({ id: params.id, field: 'role', value: newValue.inputValue });
              params.api.setEditCellValue({
                id: params.id,
                field: 'roledescription',
                value: storedRoles.find(role => role.roleName === newValue)?.roleDescription ?? ''
              });
              setSelectedRole({
                roleName: newValue.inputValue
              });
            } else {
              params.api.setEditCellValue({ id: params.id, field: 'role', value: newValue?.roleName ?? '' });
              params.api.setEditCellValue({
                id: params.id,
                field: 'roledescription',
                value: storedRoles.find(role => role.roleName === newValue)?.roleDescription ?? ''
              });
              setSelectedRole(newValue);
            }
          }}
          filterOptions={(options, params) => {
            const filtered = filter(options, params);

            const { inputValue } = params;
            // Suggest the creation of a new value
            const isExisting = options.some(option => inputValue === option.roleName);
            if (inputValue !== '' && !isExisting) {
              filtered.push({
                inputValue,
                roleName: `Add "${inputValue}"`
              });
            }

            return filtered;
          }}
          selectOnFocus
          clearOnBlur
          handleHomeEndKeys
          freeSolo
          options={storedRoles}
          getOptionLabel={option => {
            // Value selected with enter, right from the input
            if (typeof option === 'string') {
              return option;
            }
            // Add "xxx" option created dynamically
            if (option.inputValue) {
              return option.inputValue;
            }
            // Regular option
            return option.roleName;
          }}
          renderOption={(props, option) => (
            <AutocompleteOption {...props}>
              {option.roleName?.startsWith('Add "') && (
                <ListItemDecorator>
                  <Add />
                </ListItemDecorator>
              )}
              {option.roleName}
            </AutocompleteOption>
          )}
          sx={{ width: '100%' }}
          autoFocus
        />
      )
    },
    {
      field: 'roledescription',
      headerName: 'Role Description',
      flex: 1,
      editable: true
    }
  ]);

  useEffect(() => {
    console.log('selected role: ', JSON.stringify(selectedRole));
  }, [selectedRole]);

  return (
    <Box>
      {RenderFormExplanations(FormType.personnel)}
      <IsolatedMultilineDataGridCommons
        gridType="personnel"
        gridColumns={[...PersonnelFormGridColumns, ...roleColumns]}
        refresh={refresh}
        setRefresh={setRefresh}
        initialRow={initialPersonnelRow}
        setChangesSubmitted={setChangesSubmitted}
      />
    </Box>
  );
}
