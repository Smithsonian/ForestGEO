'use client';

import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import { useEffect, useState } from 'react';
import { Box, LinearProgress, Table, Textarea, IconButton, useTheme, Checkbox } from '@mui/joy';
import { PostValidationQueriesRDS } from '@/config/sqlrdsdefinitions/validations';
import dynamic from 'next/dynamic';
import moment from 'moment';
import { darken } from '@mui/system';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { Done } from '@mui/icons-material';

const Editor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

interface PostValidationResults {
  count: number;
  data: any;
}

export default function PostValidationPage() {
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const [postValidations, setPostValidations] = useState<PostValidationQueriesRDS[]>([]);
  const [validationResults, setValidationResults] = useState<Record<number, PostValidationResults | null>>({});
  const [loadingQueries, setLoadingQueries] = useState<boolean>(false);
  const [expandedQuery, setExpandedQuery] = useState<number | null>(null);
  const [expandedResults, setExpandedResults] = useState<number | null>(null);
  const [selectedResults, setSelectedResults] = useState<PostValidationQueriesRDS[]>([]);
  const replacements = {
    schema: currentSite?.schemaName,
    currentPlotID: currentPlot?.plotID,
    currentCensusID: currentCensus?.dateRanges[0].censusID
  };

  const enabledPostValidations = postValidations.filter(query => query.isEnabled);
  const disabledPostValidations = postValidations.filter(query => !query.isEnabled);

  const theme = useTheme();
  const isDarkMode = theme.palette.mode === 'dark';

  const successColor = theme.palette.mode === 'light' ? 'rgba(54, 163, 46, 0.3)' : darken('rgba(54,163,46,0.6)', 0.6);
  const failureColor = theme.palette.mode === 'light' ? 'rgba(255, 0, 0, 0.3)' : darken('rgba(255,0,0,0.6)', 0.6);

  async function fetchValidationResults(postValidation: PostValidationQueriesRDS) {
    if (!postValidation.queryID) return;
    try {
      const response = await fetch(
        `/api/postvalidationbyquery/${currentSite?.schemaName}/${currentPlot?.plotID}/${currentCensus?.dateRanges[0].censusID}/${postValidation.queryID}`,
        { method: 'GET' }
      );
      const data = await response.json();
      setValidationResults(prev => ({
        ...prev,
        [postValidation.queryID!]: data
      }));
    } catch (error) {
      console.error(`Error fetching validation results for query ${postValidation.queryID}:`, error);
      setValidationResults(prev => ({
        ...prev,
        [postValidation.queryID!]: null
      }));
    }
  }

  async function loadPostValidations() {
    try {
      setLoadingQueries(true);
      const response = await fetch(`/api/fetchall/postvalidationqueries?schema=${currentSite?.schemaName}`, { method: 'GET' });
      const data = await response.json();
      console.log('data: ', data);
      setPostValidations(data);
    } catch (error) {
      console.error('Error loading queries:', error);
    } finally {
      setLoadingQueries(false);
    }
  }

  function saveResultsToFile() {
    const blob = new Blob([JSON.stringify(selectedResults, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'results.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function printResults() {
    const printContent = selectedResults.map(result => JSON.stringify(result, null, 2)).join('\n\n');
    const printWindow = window.open('', '', 'width=600,height=400');
    printWindow?.document.write(`<pre>${printContent}</pre>`);
    printWindow?.document.close();
    printWindow?.print();
  }

  useEffect(() => {
    loadPostValidations();
  }, []);

  const handleExpandClick = (queryID: number) => {
    setExpandedQuery(expandedQuery === queryID ? null : queryID);
  };

  const handleExpandResultsClick = (queryID: number) => {
    setExpandedResults(expandedResults === queryID ? null : queryID);
  };

  const handleSelectResult = (postVal: PostValidationQueriesRDS) => {
    setSelectedResults(prev => (prev.includes(postVal) ? prev.filter(id => id !== postVal) : [...prev, postVal]));
  };

  return (
    <Box sx={{ flex: 1, display: 'flex', width: '100%' }}>
      {loadingQueries ? (
        <LinearProgress />
      ) : postValidations.length > 0 ? (
        <Box sx={{ width: '100%' }}>
          <Table
            stickyHeader
            variant={'soft'}
            sx={{
              tableLayout: 'fixed',
              width: '100%',
              '& th, & td': { padding: '8px' },
              '& td:nth-of-type(1), & th:nth-of-type(1)': {
                width: '50px',
                textAlign: 'center',
                padding: '0'
              },
              '& td:nth-of-type(3)': {
                flex: 2
              },
              '& th:nth-of-type(3)': {
                width: '45%'
              },
              '& th': {
                textAlign: 'left',
                padding: '10px'
              }
            }}
          >
            <thead>
              <tr>
                <th></th>
                <th>Query Name</th>
                <th>Query Definition</th>
                <th>Description</th>
                <th>Last Run At</th>
                <th>Last Run Result</th>
              </tr>
            </thead>
            <tbody>
              {enabledPostValidations.map(postValidation => (
                <tr
                  key={postValidation.queryID}
                  style={{
                    backgroundColor: postValidation.lastRunStatus ? (postValidation.lastRunStatus === 'success' ? successColor : failureColor) : undefined
                  }}
                >
                  <td onClick={() => handleSelectResult(postValidation)} style={{ cursor: 'pointer', padding: '0', textAlign: 'center' }}>
                    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                      <Checkbox
                        uncheckedIcon={<Done />}
                        label={''}
                        checked={selectedResults.includes(postValidation)}
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
                        onChange={e => e.stopPropagation()}
                      />
                    </Box>
                  </td>
                  <td>{postValidation.queryName}</td>
                  <td>
                    <Box
                      sx={{
                        maxWidth: expandedQuery === postValidation.queryID ? '60vw' : '100%',
                        maxHeight: expandedQuery === postValidation.queryID ? '300px' : '60px',
                        overflowX: expandedQuery === postValidation.queryID ? 'auto' : 'hidden',
                        overflowY: expandedQuery === postValidation.queryID ? 'auto' : 'hidden',
                        transition: 'all 0.3s ease',
                        whiteSpace: expandedQuery === postValidation.queryID ? 'pre-wrap' : 'nowrap',
                        position: 'relative'
                      }}
                    >
                      {expandedQuery === postValidation.queryID ? (
                        <Editor
                          height={`${Math.min(300, 20 * (postValidation?.queryDefinition ?? '').split('\n').length)}px`}
                          language="mysql"
                          value={postValidation.queryDefinition!.replace(/\${(.*?)}/g, (_match: any, p1: string) =>
                            String(replacements[p1 as keyof typeof replacements] ?? '')
                          )}
                          options={{
                            readOnly: true,
                            minimap: { enabled: false },
                            scrollBeyondLastLine: false,
                            wordWrap: 'off',
                            lineNumbers: 'off'
                          }}
                          theme={isDarkMode ? 'vs-dark' : 'light'}
                        />
                      ) : (
                        <Textarea
                          minRows={1}
                          maxRows={3}
                          value={postValidation.queryDefinition!.replace(/\${(.*?)}/g, (_match: any, p1: string) =>
                            String(replacements[p1 as keyof typeof replacements] ?? '')
                          )}
                          disabled
                          sx={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            width: '100%',
                            resize: 'none'
                          }}
                        />
                      )}
                      <Box
                        sx={{
                          position: 'absolute',
                          bottom: '4px',
                          right: '4px'
                        }}
                      >
                        <IconButton onClick={() => handleExpandClick(postValidation.queryID!)} size="sm">
                          {expandedQuery === postValidation.queryID ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                        </IconButton>
                      </Box>
                    </Box>
                  </td>
                  <td>{postValidation.description}</td>
                  <td>{postValidation.lastRunAt && <>{moment(postValidation.lastRunAt).toString()}</>}</td>
                  <td>
                    <Box
                      sx={{
                        maxWidth: expandedResults === postValidation.queryID ? '60vw' : '100%',
                        maxHeight: expandedResults === postValidation.queryID ? '300px' : '60px',
                        overflowX: expandedResults === postValidation.queryID ? 'auto' : 'hidden',
                        overflowY: expandedResults === postValidation.queryID ? 'auto' : 'hidden',
                        transition: 'all 0.3s ease',
                        whiteSpace: expandedQuery === postValidation.queryID ? 'pre-wrap' : 'nowrap',
                        position: 'relative'
                      }}
                    >
                      {postValidation.lastRunResult && (
                        <>
                          {expandedResults === postValidation.queryID ? (
                            <Textarea
                              minRows={3}
                              maxRows={10}
                              value={postValidation.lastRunResult}
                              disabled
                              sx={{
                                width: '100%',
                                overflow: 'auto',
                                whiteSpace: 'pre-wrap',
                                resize: 'none'
                              }}
                            />
                          ) : (
                            <Textarea
                              minRows={1}
                              maxRows={3}
                              value={postValidation.lastRunResult}
                              disabled
                              sx={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                width: '100%',
                                resize: 'none'
                              }}
                            />
                          )}
                          <Box
                            sx={{
                              position: 'absolute',
                              bottom: '4px',
                              right: '4px'
                            }}
                          >
                            <IconButton onClick={() => handleExpandResultsClick(postValidation.queryID!)} size="sm">
                              {expandedResults === postValidation.queryID ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                            </IconButton>
                          </Box>
                        </>
                      )}
                    </Box>
                  </td>
                </tr>
              ))}
              {disabledPostValidations.map(postValidation => (
                <tr
                  key={postValidation.queryID}
                  style={{
                    backgroundColor: postValidation.lastRunStatus ? (postValidation.lastRunStatus === 'success' ? successColor : failureColor) : undefined
                  }}
                >
                  <td onClick={() => handleSelectResult(postValidation)} style={{ cursor: 'pointer', padding: '0', textAlign: 'center' }}>
                    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                      <Checkbox
                        uncheckedIcon={<Done />}
                        label={''}
                        checked={selectedResults.includes(postValidation)}
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
                        onChange={e => e.stopPropagation()}
                      />
                    </Box>
                  </td>
                  <td>{postValidation.queryName}</td>
                  <td>
                    <Box
                      sx={{
                        maxWidth: expandedQuery === postValidation.queryID ? '60vw' : '100%',
                        maxHeight: expandedQuery === postValidation.queryID ? '300px' : '60px',
                        overflowX: expandedQuery === postValidation.queryID ? 'auto' : 'hidden',
                        overflowY: expandedQuery === postValidation.queryID ? 'auto' : 'hidden',
                        transition: 'all 0.3s ease',
                        whiteSpace: expandedQuery === postValidation.queryID ? 'pre-wrap' : 'nowrap',
                        position: 'relative'
                      }}
                    >
                      {expandedQuery === postValidation.queryID ? (
                        <Editor
                          height={`${Math.min(300, 20 * (postValidation?.queryDefinition ?? '').split('\n').length)}px`}
                          language="mysql"
                          value={postValidation.queryDefinition!.replace(/\${(.*?)}/g, (_match: any, p1: string) =>
                            String(replacements[p1 as keyof typeof replacements] ?? '')
                          )}
                          options={{
                            readOnly: true,
                            minimap: { enabled: false },
                            scrollBeyondLastLine: false,
                            wordWrap: 'off',
                            lineNumbers: 'off'
                          }}
                          theme={isDarkMode ? 'vs-dark' : 'light'}
                        />
                      ) : (
                        <Textarea
                          minRows={1}
                          maxRows={3}
                          value={postValidation.queryDefinition!.replace(/\${(.*?)}/g, (_match: any, p1: string) =>
                            String(replacements[p1 as keyof typeof replacements] ?? '')
                          )}
                          disabled
                          sx={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            width: '100%',
                            resize: 'none'
                          }}
                        />
                      )}
                      <Box
                        sx={{
                          position: 'absolute',
                          bottom: '4px',
                          right: '4px'
                        }}
                      >
                        <IconButton onClick={() => handleExpandClick(postValidation.queryID!)} size="sm">
                          {expandedQuery === postValidation.queryID ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                        </IconButton>
                      </Box>
                    </Box>
                  </td>
                  <td>{postValidation.description}</td>
                  <td>{postValidation.lastRunAt && <>{moment(postValidation.lastRunAt).toString()}</>}</td>
                  <td>
                    <Box
                      sx={{
                        maxWidth: expandedResults === postValidation.queryID ? '60vw' : '100%',
                        maxHeight: expandedResults === postValidation.queryID ? '300px' : '60px',
                        overflowX: expandedResults === postValidation.queryID ? 'auto' : 'hidden',
                        overflowY: expandedResults === postValidation.queryID ? 'auto' : 'hidden',
                        transition: 'all 0.3s ease',
                        whiteSpace: expandedQuery === postValidation.queryID ? 'pre-wrap' : 'nowrap',
                        position: 'relative'
                      }}
                    >
                      {postValidation.lastRunResult && (
                        <>
                          {expandedResults === postValidation.queryID ? (
                            <Textarea
                              minRows={3}
                              maxRows={10}
                              value={postValidation.lastRunResult}
                              disabled
                              sx={{
                                width: '100%',
                                overflow: 'auto',
                                whiteSpace: 'pre-wrap',
                                resize: 'none'
                              }}
                            />
                          ) : (
                            <Textarea
                              minRows={1}
                              maxRows={3}
                              value={postValidation.lastRunResult}
                              disabled
                              sx={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                width: '100%',
                                resize: 'none'
                              }}
                            />
                          )}
                          <Box
                            sx={{
                              position: 'absolute',
                              bottom: '4px',
                              right: '4px'
                            }}
                          >
                            <IconButton onClick={() => handleExpandResultsClick(postValidation.queryID!)} size="sm">
                              {expandedResults === postValidation.queryID ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                            </IconButton>
                          </Box>
                        </>
                      )}
                    </Box>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Box>
      ) : (
        <div>No validations available.</div>
      )}
    </Box>
  );
}
