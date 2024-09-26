'use client';

import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import { useEffect, useState } from 'react';
import { Box, LinearProgress } from '@mui/joy';

interface PostValidations {
  queryID: number;
  queryName: string;
  queryDescription: string;
}

interface PostValidationResults {
  count: number;
  data: any;
}

export default function PostValidationPage() {
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const [postValidations, setPostValidations] = useState<PostValidations[]>([]);
  const [validationResults, setValidationResults] = useState<Record<number, PostValidationResults | null>>({});
  const [loadingQueries, setLoadingQueries] = useState<boolean>(false);

  // Fetch post-validation queries on first render
  useEffect(() => {
    async function loadQueries() {
      try {
        setLoadingQueries(true);
        const response = await fetch(`/api/postvalidation?schema=${currentSite?.schemaName}`, { method: 'GET' });
        const data = await response.json();
        setPostValidations(data);
      } catch (error) {
        console.error('Error loading queries:', error);
      } finally {
        setLoadingQueries(false);
      }
    }

    if (currentSite?.schemaName) {
      loadQueries();
    }
  }, [currentSite?.schemaName]);

  // Fetch validation results for each query
  useEffect(() => {
    async function fetchValidationResults(postValidation: PostValidations) {
      try {
        const response = await fetch(
          `/api/postvalidationbyquery/${currentSite?.schemaName}/${currentPlot?.plotID}/${currentCensus?.dateRanges[0].censusID}/${postValidation.queryID}`,
          { method: 'GET' }
        );
        const data = await response.json();
        setValidationResults(prev => ({
          ...prev,
          [postValidation.queryID]: data
        }));
      } catch (error) {
        console.error(`Error fetching validation results for query ${postValidation.queryID}:`, error);
        setValidationResults(prev => ({
          ...prev,
          [postValidation.queryID]: null // Mark as failed if there was an error
        }));
      }
    }

    if (postValidations.length > 0 && currentPlot?.plotID && currentCensus?.dateRanges) {
      postValidations.forEach(postValidation => {
        fetchValidationResults(postValidation).then(r => console.log(r));
      });
    }
  }, [postValidations, currentPlot?.plotID, currentCensus?.dateRanges, currentSite?.schemaName]);

  return (
    <Box sx={{ flex: 1, display: 'flex', width: '100%' }}>
      {loadingQueries ? (
        <LinearProgress />
      ) : postValidations.length > 0 ? (
        <Box>
          {postValidations.map(postValidation => (
            <Box key={postValidation.queryID}>
              <div>{postValidation.queryName}</div>
              {validationResults[postValidation.queryID] ? <LinearProgress determinate value={100} /> : <LinearProgress />}
            </Box>
          ))}
        </Box>
      ) : (
        <div>No validations available.</div>
      )}
    </Box>
  );
}
