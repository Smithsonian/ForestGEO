'use client';

import { Card, CardContent, Typography } from '@mui/joy';
import React from 'react';
import ValidationProceduresDataGrid from '@/components/datagrids/applications/validationproceduresdatagrid';

export default function ValidationsPage() {
  return (
    <Card variant={'plain'} sx={{ width: '100%' }}>
      <CardContent>
        <Typography level={'title-lg'} fontWeight={'bold'}>
          Review Global Validations
        </Typography>
        <ValidationProceduresDataGrid />
      </CardContent>
    </Card>
  );
}
