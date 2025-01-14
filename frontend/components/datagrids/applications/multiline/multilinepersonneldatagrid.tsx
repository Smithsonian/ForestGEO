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
import { GridRenderEditCellParams, useGridApiContext } from '@mui/x-data-grid';
import { Add } from '@mui/icons-material';
import levenshtein from 'fast-levenshtein';

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
      renderEditCell: (params: GridRenderEditCellParams) => {
        const apiRef = useGridApiContext();
        return (
          <Autocomplete
            value={params.row['role']}
            onChange={(_event, newValue: any) => {
              const autoCorrectRole = (input: string): string => {
                const closestMatch = storedRoles.reduce(
                  (bestMatch, role) => {
                    const roleName = role.roleName?.toLowerCase() || '';
                    if (!roleName) return bestMatch;

                    const distance = levenshtein.get(input.toLowerCase(), roleName);

                    return distance < bestMatch.distance ? { role: role.roleName!, distance } : bestMatch;
                  },
                  { role: '', distance: Number.MAX_VALUE }
                );

                return closestMatch.distance <= 3 ? closestMatch.role : input;
              };

              let roleValue = '';
              let roledescriptionValue = '';

              if (typeof newValue === 'string') {
                roleValue = autoCorrectRole(newValue);
                roledescriptionValue = storedRoles.find(role => role.roleName === roleValue)?.roleDescription ?? '';
              } else if (newValue && newValue.inputValue) {
                roleValue = autoCorrectRole(newValue.inputValue);
                roledescriptionValue = storedRoles.find(role => role.roleName === roleValue)?.roleDescription ?? '';
              } else {
                roleValue = autoCorrectRole(newValue?.roleName ?? '');
                roledescriptionValue = storedRoles.find(role => role.roleName === roleValue)?.roleDescription ?? '';
              }

              params.api.setEditCellValue({
                id: params.id,
                field: 'role',
                value: roleValue
              });

              // Update `role` field
              apiRef.current.updateRows([
                {
                  id: params.id,
                  roledescription: roledescriptionValue
                }
              ]);
            }}
            filterOptions={(options, params) => {
              const filtered = filter(options, params);

              const { inputValue } = params;
              // Suggest the creation of a new value
              const isExisting = options.some(option => inputValue === option.roleName);
              if (inputValue !== '' && !isExisting) {
                filtered.push({
                  inputValue,
                  roleName: `Add "${inputValue}"`,
                  roleDescription: ``
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
              <AutocompleteOption key={option.roleName} {...props}>
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
        );
      }
    },
    {
      field: 'roledescription',
      headerName: 'Role Description',
      flex: 1,
      editable: true
    }
  ]);
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
