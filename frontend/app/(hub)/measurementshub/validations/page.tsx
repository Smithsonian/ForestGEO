'use client';
import React, { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { ValidationProceduresRDS } from '@/config/sqlrdsdefinitions/validations';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/compat-hooks';
import { useSession } from 'next-auth/react';
import { useTheme } from '@mui/joy';
import dynamic from 'next/dynamic';
import { Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Box, Button, Alert, CircularProgress, Typography } from '@mui/material';
import { Add } from '@mui/icons-material';
import ailogger from '@/ailogger';

const fetcher = (url: string) => fetch(url).then(res => res.json());

const ValidationRow = dynamic(() => import('@/components/validationrow'), { ssr: false });
const NewValidationRow = dynamic(() => import('@/components/newvalidationrow'), { ssr: false });

export default function ValidationsPage() {
  const { data: session } = useSession();
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const theme = useTheme();
  const isDarkMode = theme.palette.mode === 'dark';

  const {
    data: globalValidations,
    mutate: updateValidations,
    error: validationsError,
    isLoading: validationsLoading
  } = useSWR<ValidationProceduresRDS[]>(currentSite?.schemaName ? `/api/validations/crud?schema=${currentSite.schemaName}` : null, fetcher);

  const {
    data: schemaData,
    error: schemaError,
    isLoading: schemaLoading
  } = useSWR<{ schema: { table_name: string; column_name: string }[] }>(currentSite?.schemaName ? `/api/structure/${currentSite.schemaName}` : null, fetcher);

  const replacements = useMemo(
    () => ({
      schema: currentSite?.schemaName,
      currentPlotID: currentPlot?.plotID,
      currentCensusID: currentCensus?.dateRanges?.[0]?.censusID
    }),
    [currentSite?.schemaName, currentPlot?.plotID, currentCensus?.dateRanges]
  );

  const [expandedValidationID, setExpandedValidationID] = useState<number | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [newValidation, setNewValidation] = useState<ValidationProceduresRDS>({
    procedureName: '',
    description: '',
    criteria: '',
    definition: '',
    isEnabled: false
  });

  useEffect(() => {
    if (session && !['db admin', 'global'].includes(session.user.userStatus)) {
      setAccessDenied(true);
    }
  }, [session]);

  // Render access denied message instead of throwing error
  if (accessDenied) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error">
          <Typography variant="h6">Access Denied</Typography>
          <Typography>
            You do not have permission to view this page. Only database administrators and global users can access validations management.
          </Typography>
        </Alert>
      </Box>
    );
  }

  const handleSaveChanges = async (updatedValidation: ValidationProceduresRDS) => {
    try {
      const response = await fetch(`/api/validations/crud?schema=${currentSite?.schemaName}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedValidation)
      });
      if (response.ok) {
        await updateValidations(prev => (prev ? prev.map(val => (val.validationID === updatedValidation.validationID ? updatedValidation : val)) : []));
      } else {
        const errorText = await response.text();
        ailogger.error('Failed to update validation', undefined, { errorText, status: response.status, statusText: response.statusText });
        throw new Error(`Failed to update validation: ${response.status} ${response.statusText}`);
      }
    } catch (error: any) {
      ailogger.error('Error updating validation:', error);
      throw error; // Re-throw to allow child components to handle error display
    }
  };

  function handleToggleClick(incomingValidationID: number) {
    setExpandedValidationID(prev => (prev === incomingValidationID ? null : incomingValidationID));
  }

  const handleCreateNew = async () => {
    try {
      const response = await fetch(`/api/validations/crud?schema=${currentSite?.schemaName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newValidation)
      });
      if (response.ok) {
        const result = await response.json();
        const createdValidation = {
          ...newValidation,
          validationID: result.validationID || result.insertID
        };
        await updateValidations(prev => (prev ? [...prev, createdValidation] : [createdValidation]));
        setNewValidation({
          procedureName: '',
          description: '',
          criteria: '',
          definition: '',
          isEnabled: false
        });
        setIsCreatingNew(false);
      } else {
        const errorText = await response.text();
        ailogger.error('Failed to create validation', undefined, { errorText, status: response.status, statusText: response.statusText });
        throw new Error(`Failed to create validation: ${response.status} ${response.statusText}`);
      }
    } catch (error: any) {
      ailogger.error('Error creating validation:', error);
      throw error; // Re-throw to allow child components to handle error display
    }
  };

  const handleCancelCreate = () => {
    setNewValidation({
      procedureName: '',
      description: '',
      criteria: '',
      definition: '',
      isEnabled: false
    });
    setIsCreatingNew(false);
  };

  const handleNewValidationChange = (field: keyof ValidationProceduresRDS, value: any) => {
    setNewValidation(prev => ({ ...prev, [field]: value }));
  };

  // Show error if no site is selected
  if (!currentSite) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">Please select a site to view and manage validations.</Alert>
      </Box>
    );
  }

  // Show loading state
  if (validationsLoading || schemaLoading) {
    return (
      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        <CircularProgress />
        <Typography>Loading validations...</Typography>
      </Box>
    );
  }

  // Show error state
  if (validationsError || schemaError) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">Failed to load validations: {validationsError?.message || schemaError?.message || 'Unknown error'}</Alert>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Button variant="contained" startIcon={<Add />} onClick={() => setIsCreatingNew(true)} disabled={isCreatingNew || !currentSite}>
          Add New Validation
        </Button>
      </Box>

      <TableContainer component={Paper}>
        <Table stickyHeader sx={{ tableLayout: 'fixed', width: '100%' }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: '5%' }}>Enabled?</TableCell>
              <TableCell sx={{ width: '10%' }}>Validation</TableCell>
              <TableCell sx={{ width: '15%' }}>Description</TableCell>
              <TableCell sx={{ width: '10%' }}>Affecting Criteria</TableCell>
              <TableCell sx={{ flexGrow: 1, flexShrink: 0, flexBasis: '35%' }}>Query</TableCell>
              <TableCell sx={{ width: '10%' }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isCreatingNew && (
              <NewValidationRow
                validation={newValidation}
                onValidationChange={handleNewValidationChange}
                onSave={handleCreateNew}
                onCancel={handleCancelCreate}
                schemaDetails={schemaData?.schema || []}
                isDarkMode={isDarkMode}
                schema={currentSite?.schemaName}
              />
            )}
            {globalValidations?.map(validation => (
              <ValidationRow
                key={validation.validationID}
                validation={validation}
                onSaveChanges={handleSaveChanges}
                schemaDetails={schemaData?.schema || []}
                expandedValidationID={expandedValidationID}
                handleExpandClick={() => handleToggleClick(validation.validationID!)}
                isDarkMode={isDarkMode}
                replacements={replacements}
              />
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
