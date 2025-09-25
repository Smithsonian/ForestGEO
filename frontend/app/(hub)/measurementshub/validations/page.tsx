'use client';
import React, { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { ValidationProceduresRDS } from '@/config/sqlrdsdefinitions/validations';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import { useSession } from 'next-auth/react';
import { useTheme } from '@mui/joy';
import dynamic from 'next/dynamic';
import { Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from '@mui/material';
import ailogger from '@/ailogger';

const fetcher = (url: string) => fetch(url).then(res => res.json());

const ValidationRow = dynamic(() => import('@/components/validationrow'), { ssr: false });

export default function ValidationsPage() {
  const { data: session } = useSession();
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const theme = useTheme();
  const isDarkMode = theme.palette.mode === 'dark';

  const { data: globalValidations, mutate: updateValidations } = useSWR<ValidationProceduresRDS[]>(
    `/api/validations/crud?schema=${currentSite?.schemaName}`,
    fetcher
  );

  const { data: schemaData } = useSWR<{ schema: { table_name: string; column_name: string }[] }>(
    currentSite?.schemaName ? `/api/structure/${currentSite.schemaName}` : null,
    fetcher
  );

  const replacements = useMemo(
    () => ({
      schema: currentSite?.schemaName,
      currentPlotID: currentPlot?.plotID,
      currentCensusID: currentCensus?.dateRanges[0].censusID
    }),
    [currentSite?.schemaName, currentPlot?.plotID, currentCensus?.dateRanges]
  );

  const [expandedValidationID, setExpandedValidationID] = useState<number | null>(null);

  useEffect(() => {
    if (session && !['db admin', 'global'].includes(session.user.userStatus)) {
      throw new Error('access-denied');
    }
  }, [session]);

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
        ailogger.error('Failed to update validation');
      }
    } catch (error: any) {
      ailogger.error('Error updating validation:', error);
    }
  };

  function handleToggleClick(incomingValidationID: number) {
    setExpandedValidationID(prev => (prev === incomingValidationID ? null : incomingValidationID));
  }

  return (
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
  );
}
