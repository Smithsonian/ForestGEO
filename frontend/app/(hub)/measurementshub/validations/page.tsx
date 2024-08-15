'use client';

import { Box, Card, CardContent, Typography } from '@mui/joy';
import React from 'react';
import ValidationProceduresDataGrid from '@/components/datagrids/applications/validationproceduresdatagrid';
import SiteSpecificValidationsDataGrid from '@/components/datagrids/applications/sitespecificvalidationsdatagrid';

export default function ValidationsPage() {
  return (
    <Box sx={{ width: '100%' }}>
      <Card variant={'plain'} sx={{ width: '100%' }}>
        <CardContent>
          <Typography level={'title-lg'} fontWeight={'bold'}>
            Review Global Validations
          </Typography>
          <ValidationProceduresDataGrid />
        </CardContent>
      </Card>
      <Card variant={'plain'} sx={{ width: '100%' }}>
        <CardContent>
          <Typography level={'title-lg'} fontWeight={'bold'}>
            Review Site-Specific Validations
          </Typography>
          <SiteSpecificValidationsDataGrid />
        </CardContent>
      </Card>
    </Box>
  );
}
