'use client';

import { Box, Card, CardContent, Typography } from '@mui/joy';
import React, { useEffect, useState } from 'react';
import ValidationCard from '@/components/validationcard';
import { ValidationProceduresRDS } from '@/config/sqlrdsdefinitions/validations';
import { useSiteContext } from '@/app/contexts/userselectionprovider';
import { useSession } from 'next-auth/react';

export default function ValidationsPage() {
  const [globalValidations, setGlobalValidations] = React.useState<ValidationProceduresRDS[]>([]);
  const [loading, setLoading] = useState<boolean>(true); // Use a loading state instead of refresh
  const [schemaDetails, setSchemaDetails] = useState<{ table_name: string; column_name: string }[]>([]);
  const { data: session } = useSession();

  const currentSite = useSiteContext();

  useEffect(() => {
    if (session !== null && !['db admin', 'global'].includes(session.user.userStatus)) {
      throw new Error('access-denied');
    }
  }, []);

  const handleSaveChanges = async (updatedValidation: ValidationProceduresRDS) => {
    try {
      // Make the API call to toggle the validation
      const response = await fetch(`/api/validations/crud`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedValidation) // Pass the entire updated validation object
      });
      if (response.ok) {
        // Update the globalValidations state directly
        setGlobalValidations(prev => prev.map(val => (val.validationID === updatedValidation.validationID ? updatedValidation : val)));
      } else {
        console.error('Failed to toggle validation');
      }
    } catch (error) {
      console.error('Error toggling validation:', error);
    }
  };

  const handleDelete = async (validationID?: number) => {
    try {
      // Make the API call to delete the validation
      const response = await fetch(`/api/validations/delete/${validationID}`, {
        method: 'DELETE'
      });
      if (response.ok) {
        // Remove the deleted validation from the globalValidations state
        setGlobalValidations(prev => prev.filter(validation => validation.validationID !== validationID));
      } else {
        console.error('Failed to delete validation');
      }
    } catch (error) {
      console.error('Error deleting validation:', error);
    }
  };

  useEffect(() => {
    async function fetchValidations() {
      try {
        const response = await fetch('/api/validations/crud', { method: 'GET' });
        const data = await response.json();
        setGlobalValidations(data);
      } catch (err) {
        console.error('Error fetching validations:', err);
      } finally {
        setLoading(false); // Loading is complete
      }
    }

    fetchValidations().catch(console.error); // Initial load
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Set up Monaco Editor worker path
      window.MonacoEnvironment = {
        getWorkerUrl: function () {
          return '_next/static/[name].worker.js';
        }
      };
    }
  }, []);

  // Fetch schema details when component mounts
  useEffect(() => {
    const fetchSchema = async () => {
      try {
        const response = await fetch(`/api/structure/${currentSite?.schemaName ?? ''}`);
        const data = await response.json();
        if (data.schema) {
          setSchemaDetails(data.schema);
        }
      } catch (error) {
        console.error('Error fetching schema:', error);
      }
    };

    if (currentSite?.schemaName) {
      fetchSchema().then(r => console.log(r));
    }
  }, [currentSite?.schemaName]);

  return (
    <Box sx={{ width: '100%' }}>
      <Card variant={'plain'} sx={{ width: '100%' }}>
        <CardContent>
          <Typography level={'title-lg'} fontWeight={'bold'}>
            Review Global Validations
          </Typography>
          {globalValidations.map(validation => (
            <ValidationCard
              onDelete={handleDelete}
              onSaveChanges={handleSaveChanges}
              validation={validation}
              key={validation.validationID}
              schemaDetails={schemaDetails}
            />
          ))}
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
