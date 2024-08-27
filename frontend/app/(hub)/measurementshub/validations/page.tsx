'use client';

import { Box, Card, CardContent, Typography } from '@mui/joy';
import React, { useEffect } from 'react';
import { useSiteContext } from '@/app/contexts/userselectionprovider';
import ValidationCard from '@/components/validationcard';
import { ValidationProceduresRDS } from '@/config/sqlrdsdefinitions/validations';

export default function ValidationsPage() {
  const currentSite = useSiteContext();
  const [globalValidations, setGlobalValidations] = React.useState<ValidationProceduresRDS[]>([]);

  const handleToggle = (enabled?: boolean) => {
    console.log('Validation enabled:', enabled);
  };

  const handleSaveChanges = (newSqlCode?: string) => {
    console.log('New SQL Code:', newSqlCode);
  };

  const handleDelete = () => {
    console.log('Validation deleted');
  };

  useEffect(() => {
    async function fetchValidations() {
      const response = await fetch('/api/fetchall/validationprocedures?schema=' + currentSite?.schemaName);
      setGlobalValidations(await response.json());
    }

    fetchValidations().catch(err => console.error(err));
  }, []);
  return (
    <Box sx={{ width: '100%' }}>
      <Card variant={'plain'} sx={{ width: '100%' }}>
        <CardContent>
          <Typography level={'title-lg'} fontWeight={'bold'}>
            Review Global Validations
          </Typography>
          {globalValidations.length > 0 && (
            <ValidationCard onDelete={handleDelete} onSaveChanges={handleSaveChanges} onToggle={handleToggle} {...globalValidations[0]} />
          )}
        </CardContent>
      </Card>
      <Card variant={'plain'} sx={{ width: '100%' }}>
        <CardContent>
          <Typography level={'title-lg'} fontWeight={'bold'}>
            Review Site-Specific Validations
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
