// postvalidation/page.tsx
'use client';

import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import React, { useEffect, useState } from 'react';
import { Box, Button, Checkbox, Table, Typography, useTheme } from '@mui/joy';
import { PostValidationQueriesRDS } from '@/config/sqlrdsdefinitions/validations';
import { Paper, TableBody, TableCell, TableContainer, TableHead, TableRow } from '@mui/material';
import { Done } from '@mui/icons-material';
import { useLoading } from '@/app/contexts/loadingprovider';
import dynamic from 'next/dynamic';
import ailogger from '@/ailogger';

const PostValidationRow = dynamic(() => import('@/components/client/postvalidationrow'), { ssr: false });

export default function PostValidationPage() {
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const [postValidations, setPostValidations] = useState<PostValidationQueriesRDS[]>([]);
  const [expandedQuery, setExpandedQuery] = useState<number | null>(null);
  const [expandedResults, setExpandedResults] = useState<number | null>(null);
  const [selectedResults, setSelectedResults] = useState<PostValidationQueriesRDS[]>([]);
  const [schemaDetails, setSchemaDetails] = useState<{ table_name: string; column_name: string }[]>([]);
  const replacements = {
    schema: currentSite?.schemaName,
    currentPlotID: currentPlot?.plotID,
    currentCensusID: currentCensus?.dateRanges[0].censusID
  };
  const { setLoading } = useLoading();

  const enabledPostValidations = postValidations.filter(query => query.isEnabled);
  const disabledPostValidations = postValidations.filter(query => !query.isEnabled);

  const theme = useTheme();
  const isDarkMode = theme.palette.mode === 'dark';

  async function fetchValidationResults(postValidation: PostValidationQueriesRDS) {
    if (!postValidation.queryID) return;
    try {
      await fetch(
        `/api/postvalidationbyquery/${currentSite?.schemaName}/${currentPlot?.plotID}/${currentCensus?.dateRanges[0].censusID}/${postValidation.queryID}`,
        { method: 'GET' }
      );
    } catch (error: any) {
      ailogger.error(`Error fetching validation results for query ${postValidation.queryID}:`, error);
      throw new Error(error);
    }
  }

  async function loadPostValidations() {
    try {
      const response = await fetch(
        `/api/fetchall/postvalidationqueries/${currentPlot?.plotID ?? 0}/${currentCensus?.plotCensusNumber ?? 0}?schema=${currentSite?.schemaName}`,
        { method: 'GET' }
      );
      const data = await response.json();
      setPostValidations(data);
    } catch (error: any) {
      ailogger.error('Error loading queries:', error);
    }
  }

  function saveResultsToFile() {
    if (selectedResults.length === 0) {
      alert('Please select at least one result to save.');
      return;
    }
    const blob = new Blob([JSON.stringify(selectedResults, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'results.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function printResults() {
    if (selectedResults.length === 0) {
      alert('Please select at least one result to print.');
      return;
    }
    const printContent = selectedResults.map(result => JSON.stringify(result, null, 2)).join('\n\n');
    const printWindow = window.open('', '', 'width=600,height=400');
    if (printWindow) {
      const preElement = printWindow.document.createElement('pre');
      preElement.textContent = printContent;
      printWindow.document.body.appendChild(preElement);
      printWindow.document.close();
      printWindow.print();
    }
  }

  useEffect(() => {
    setLoading(true);
    loadPostValidations()
      .catch(ailogger.error)
      .then(() => setLoading(false));
  }, []);

  useEffect(() => {
    const fetchSchema = async () => {
      try {
        const response = await fetch(`/api/structure/${currentSite?.schemaName ?? ''}`);
        const data = await response.json();
        if (data.schema) {
          setSchemaDetails(data.schema);
        }
      } catch (error: any) {
        ailogger.error('Error fetching schema:', error);
      }
    };

    if (postValidations.length > 0) {
      fetchSchema().then((r: any) => ailogger.warn(r));
    }
  }, [postValidations]);

  const handleExpandClick = (queryID: number) => {
    setExpandedQuery(expandedQuery === queryID ? null : queryID);
  };

  const handleExpandResultsClick = (queryID: number) => {
    setExpandedResults(expandedResults === queryID ? null : queryID);
  };

  const handleSelectResult = (postVal: PostValidationQueriesRDS) => {
    setSelectedResults(prev => (prev.includes(postVal) ? prev.filter(id => id !== postVal) : [...prev, postVal]));
  };

  const handleSelectAllChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.checked) {
      // Select all: add all validations to selectedResults
      setSelectedResults([...enabledPostValidations, ...disabledPostValidations]);
    } else {
      // Deselect all: clear selectedResults
      setSelectedResults([]);
    }
  };

  // Check if all items are selected
  const isAllSelected = selectedResults.length === postValidations.length && postValidations.length > 0;

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', width: '100%' }}>
      <Box sx={{ justifyContent: 'space-between', alignContent: 'space-between', flex: 1, display: 'flex', flexDirection: 'row' }}>
        <Typography>These statistics can be used to analyze entered data. Please select and run, download, or print statistics as needed.</Typography>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
          <Button variant={'soft'} onClick={() => saveResultsToFile()} sx={{ marginX: 1 }}>
            Download Statistics
          </Button>
          <Button variant={'soft'} onClick={() => printResults()} sx={{ marginX: 1 }}>
            Print Statistics
          </Button>
          <Button
            variant={'soft'}
            onClick={async () => {
              if (selectedResults.length === 0) {
                alert('Please select at least one statistic to run.');
                return;
              }
              setLoading(true, 'Running validations...');
              for (const postValidation of selectedResults) {
                await fetchValidationResults(postValidation);
                setSelectedResults([]);
              }
              await loadPostValidations();
              setLoading(false);
            }}
          >
            Run Statistics
          </Button>
        </Box>
      </Box>

      {postValidations.length > 0 ? (
        <Box sx={{ width: '100%' }}>
          <TableContainer component={Paper}>
            <Table
              stickyHeader
              sx={{
                tableLayout: 'fixed',
                width: '100%'
              }}
            >
              <TableHead>
                <TableRow>
                  <TableCell
                    aria-label={'blank space here'}
                    sx={{
                      width: '50px',
                      textAlign: 'center',
                      padding: '0'
                    }}
                  />
                  <TableCell
                    aria-label={isAllSelected ? 'selected cell' : 'unselected cell'}
                    sx={{
                      flex: 0.5,
                      display: 'flex',
                      alignSelf: 'center',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '0'
                    }}
                  >
                    <Checkbox
                      aria-label={'toggle to select/deselect all'}
                      uncheckedIcon={<Done />}
                      label={isAllSelected ? 'Deselect All' : 'Select All'}
                      checked={isAllSelected}
                      slotProps={{
                        root: ({ checked, focusVisible }) => ({
                          sx: !checked
                            ? {
                                '& svg': { opacity: focusVisible ? 1 : 0 },
                                '&:hover svg': {
                                  opacity: 1
                                }
                              }
                            : undefined
                        })
                      }}
                      onChange={e => handleSelectAllChange(e)}
                    />
                  </TableCell>
                  <TableCell>Query Name</TableCell>
                  <TableCell
                    sx={{
                      width: '45%'
                    }}
                  >
                    Query Definition
                  </TableCell>
                  <TableCell>Description</TableCell>
                  <TableCell>Last Run At</TableCell>
                  <TableCell>Last Run Result</TableCell>
                </TableRow>
              </TableHead>

              <TableBody>
                {enabledPostValidations.map(postValidation => (
                  <PostValidationRow
                    key={postValidation.queryID}
                    postValidation={postValidation}
                    selectedResults={selectedResults}
                    expanded={expandedResults !== null && expandedResults === postValidation.queryID}
                    isDarkMode={isDarkMode}
                    expandedQuery={expandedQuery}
                    replacements={replacements}
                    handleExpandClick={handleExpandClick}
                    handleExpandResultsClick={handleExpandResultsClick}
                    handleSelectResult={handleSelectResult}
                    schemaDetails={schemaDetails}
                  />
                ))}

                {disabledPostValidations.map(postValidation => (
                  <PostValidationRow
                    key={postValidation.queryID}
                    postValidation={postValidation}
                    selectedResults={selectedResults}
                    expanded={expandedResults !== null && expandedResults === postValidation.queryID}
                    isDarkMode={isDarkMode}
                    expandedQuery={expandedQuery}
                    replacements={replacements}
                    handleExpandClick={handleExpandClick}
                    handleExpandResultsClick={handleExpandResultsClick}
                    handleSelectResult={handleSelectResult}
                    schemaDetails={schemaDetails}
                  />
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      ) : (
        <Box>No validations available.</Box>
      )}
    </Box>
  );
}
