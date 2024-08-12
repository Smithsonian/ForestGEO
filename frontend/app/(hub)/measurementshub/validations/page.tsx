'use client';

import { Box, Card, CardContent, Typography } from '@mui/joy';
import React, { useEffect, useState } from 'react';
import { useSiteContext } from '@/app/contexts/userselectionprovider';
import { ValidationProceduresRDS } from '@/config/sqlrdsdefinitions/tables/validationproceduresrds';
import { StyledDataGrid } from '@/config/styleddatagrid';
import { CMVErrorGridColumns, ValidationProceduresGridColumns } from '@/components/client/datagridcolumns';
import { GridToolbar } from '@mui/x-data-grid';
import Divider from '@mui/joy/Divider';
import { CMVErrorRDS } from '@/config/sqlrdsdefinitions/tables/cmrds';

export default function ValidationsPage() {
  const currentSite = useSiteContext();
  const [loading, setLoading] = useState(false);
  const [validationProcedures, setValidationProcedures] = useState<ValidationProceduresRDS[]>([]);
  const [currentErrors, setCurrentErrors] = useState<CMVErrorRDS[]>([]);
  useEffect(() => {
    async function getValidations() {
      setLoading(true);
      const response = await fetch(`/api/fetchall/validationprocedures?schema=${currentSite?.schemaName}`, { method: 'GET' });
      setValidationProcedures(await response.json());
    }

    async function getCurrentErrors() {
      setLoading(true);
      const response = await fetch(`/api/fetchall/cmverrors?schema=${currentSite?.schemaName}`, { method: 'GET' });
      setCurrentErrors(await response.json());
    }

    getValidations().catch(console.error);
    getCurrentErrors().catch(console.error);
  }, [currentSite]);

  useEffect(() => {
    if (loading && validationProcedures.length > 0) setLoading(false);
  }, [loading, validationProcedures]);
  return (
    <Box sx={{ display: 'flex', flex: 1, width: '100%', position: 'relative' }}>
      <Card variant={'plain'} sx={{ width: '50%' }}>
        <CardContent>
          <Typography level={'title-lg'} fontWeight={'bold'}>
            Review Validations
          </Typography>
          <StyledDataGrid
            slots={{ toolbar: GridToolbar }}
            loading={loading}
            disableColumnSelector
            sx={{ width: '100%' }}
            columns={ValidationProceduresGridColumns}
            rows={validationProcedures}
            initialState={{
              columns: {
                columnVisibilityModel: {
                  id: false,
                  validationID: false,
                  updatedAt: false
                }
              }
            }}
          />
        </CardContent>
      </Card>
      <Divider orientation={'vertical'} sx={{ mx: 1 }} />
      <Card variant="plain" sx={{ width: '50%' }}>
        <CardContent>
          <Typography level={'title-lg'} fontWeight={'bold'}>
            Rows Failing Validation
          </Typography>
          <StyledDataGrid
            slots={{ toolbar: GridToolbar }}
            loading={loading}
            disableColumnSelector
            sx={{ width: '100%' }}
            columns={CMVErrorGridColumns}
            rows={currentErrors}
            initialState={{
              columns: {
                columnVisibilityModel: {
                  id: false
                }
              }
            }}
          />
        </CardContent>
      </Card>
    </Box>
  );
}
