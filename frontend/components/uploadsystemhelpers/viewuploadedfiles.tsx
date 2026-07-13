'use client';
import React, { Dispatch, SetStateAction, useCallback, useEffect, useRef, useState } from 'react';
import { useIsMounted } from '@/app/hooks/useismounted';
import { tableHeaderSettings } from '@/config/macros';
import { fileColumns, UploadedFileData } from '@/config/macros/formdetails';
import { Button, Card, CardContent, CardHeader, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from '@mui/material';
import { DeleteIcon, DownloadIcon } from '@/components/icons';
import Divider from '@mui/joy/Divider';
import CircularProgress from '@mui/joy/CircularProgress';
import Box from '@mui/joy/Box';
import Typography from '@mui/joy/Typography';
import Alert from '@mui/joy/Alert';
import { Plot } from '@/lib/db/definitions/zones';
import { OrgCensus } from '@/lib/db/definitions/timekeeping';
import ailogger from '@/ailogger';
import { getContainerName, SchemaContainerNameError } from '@/config/macros/containernames';
import { useSiteContext } from '@/app/contexts/compat-hooks';
import { formatDisplayDate } from '@/config/dateformats';

const CONTAINER_NAME_UNAVAILABLE = 'none';
const CONTAINER_NAME_UNMAPPABLE = 'unavailable (schema cannot be mapped to a storage container)';

export function containerDisplayName(schemaName: string | undefined, plotID: number | undefined, censusNumber: number | undefined): string {
  if (!schemaName || !plotID || !censusNumber) {
    return CONTAINER_NAME_UNAVAILABLE;
  }
  // getContainerName fails closed (throws) for schemas it cannot map
  // injectively; this label is display-only, so degrade instead of letting the
  // throw crash the whole page render. File operations still surface the 400.
  try {
    return getContainerName(schemaName, plotID, censusNumber);
  } catch (error) {
    if (error instanceof SchemaContainerNameError) {
      return CONTAINER_NAME_UNMAPPABLE;
    }
    ailogger.warn(`Failed to derive container display name for ${schemaName}`, error instanceof Error ? error : undefined);
    return CONTAINER_NAME_UNAVAILABLE;
  }
}

interface LoadingFilesProps {
  currentPlot: Plot | null;
  currentCensus: OrgCensus;
  refreshFiles: () => void;
}

function LoadingFiles(props: Readonly<LoadingFilesProps>) {
  const { currentPlot, currentCensus, refreshFiles } = props;
  useEffect(() => {
    refreshFiles();
  }, [refreshFiles]); // on mount

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      <Typography level={'title-lg'}>
        Files uploaded to {currentPlot?.plotName ?? 'this plot'}, census {currentCensus?.plotCensusNumber ?? '—'}
        <br />
        <Button sx={{ width: 'fit-content' }} onClick={refreshFiles}>
          Refresh Files
        </Button>
        <br />
        Stored source files
      </Typography>
      <Card className="flex flex-col items-center justify-center gap-4 py-8 md:py-10">
        <CardHeader>
          <div className="flex flex-col">
            <h5 className="text-md">Loading Files...</h5>
          </div>
        </CardHeader>
        <Divider className={'mt-6 mb-6'} />
        <CardContent>
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center'
            }}
          >
            <CircularProgress size={'lg'} color={'danger'} variant={'soft'} />
            <Typography variant={'soft'} color={'warning'}>
              Retrieving files...
            </Typography>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}

interface VUFProps {
  currentPlot: Plot | null;
  currentCensus: OrgCensus;
  refreshFileList: boolean;
  setRefreshFileList: Dispatch<SetStateAction<boolean>>;
}

export default function ViewUploadedFiles(props: Readonly<VUFProps>) {
  const { currentPlot, currentCensus, refreshFileList, setRefreshFileList } = props;
  const currentSite = useSiteContext();
  const [isLoaded, setIsLoaded] = useState(false);
  const [fileRows, setFileRows] = useState<UploadedFileData[]>();
  const [errorMessage, setErrorMessage] = useState('');
  const listAbortRef = useRef<AbortController | null>(null);

  // Track mounted state to prevent state updates after unmount
  const { isMountedRef } = useIsMounted();

  const buildScopedParams = useCallback(
    (filename?: string) => {
      if (!currentSite?.schemaName || !currentCensus?.plotCensusNumber || !currentPlot?.plotID) {
        throw new Error('Missing required file scope (site, plot, or census)');
      }

      const params = new URLSearchParams({
        schema: currentSite.schemaName,
        plotID: currentPlot.plotID.toString(),
        census: currentCensus.plotCensusNumber.toString()
      });

      if (filename) {
        params.append('filename', filename);
      }

      return params;
    },
    [currentSite?.schemaName, currentCensus?.plotCensusNumber, currentPlot?.plotID]
  );

  const handleDownload = async (filename: string) => {
    try {
      const params = buildScopedParams(filename);
      const response = await fetch(`/api/files/download?${params.toString()}`);

      if (!response.ok) throw new Error('Error getting download link');

      const data = (await response.json()) as { url?: unknown };
      if (typeof data.url !== 'string') throw new Error('Download response did not include a URL');
      const downloadUrl = new URL(data.url, window.location.origin);
      if (downloadUrl.protocol !== 'https:' && downloadUrl.origin !== window.location.origin) {
        throw new Error('Download response used an unsafe URL');
      }
      window.location.href = downloadUrl.href;
    } catch (error: any) {
      ailogger.error('Download error:', error);
      if (isMountedRef.current) {
        setErrorMessage(error.message);
      }
    }
  };

  const handleDelete = async (filename: string) => {
    if (!window.confirm(`Delete “${filename}”? This action cannot be undone.`)) return;
    try {
      const params = buildScopedParams(filename);
      const response = await fetch(`/api/files/delete?${params.toString()}`, {
        method: 'DELETE'
      });

      if (!response.ok) throw new Error('Error deleting file');

      // Refresh the file list after successful deletion
      if (isMountedRef.current) {
        setRefreshFileList(true);
      }
    } catch (error: any) {
      ailogger.error('Delete error:', error);
      if (isMountedRef.current) {
        setErrorMessage(error.message);
      }
    }
  };

  const getListOfFiles = useCallback(async () => {
    listAbortRef.current?.abort();
    const controller = new AbortController();
    listAbortRef.current = controller;
    try {
      const params = buildScopedParams();

      const response = await fetch(`/api/files/list?${params.toString()}`, {
        method: 'GET',
        signal: controller.signal
      });

      if (!isMountedRef.current) return;

      if (!response.ok) {
        const jsonOutput = await response.json();
        ailogger.error('response.statusText', jsonOutput.statusText);
        setErrorMessage(`API response: ${jsonOutput.statusText}`);
        setFileRows([]);
        setIsLoaded(true);
      } else {
        const data = await response.json();
        setFileRows(data.blobData);
        setIsLoaded(true);
      }
    } catch (error: any) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (isMountedRef.current) {
        setErrorMessage(error.message);
        setFileRows([]);
        setIsLoaded(true);
      }
    }
  }, [buildScopedParams, isMountedRef]);

  useEffect(() => () => listAbortRef.current?.abort(), []);

  // Handle refresh file list - use ref to track previous state to avoid infinite rerender
  const previousRefreshFileList = useRef(refreshFileList);
  useEffect(() => {
    // Only refresh when transitioning from false to true
    if (refreshFileList && !previousRefreshFileList.current && currentPlot && currentCensus) {
      getListOfFiles()
        .then(() => setRefreshFileList(false))
        .catch(ailogger.error);
    }
    previousRefreshFileList.current = refreshFileList;
  }, [refreshFileList, currentPlot, currentCensus, getListOfFiles, setRefreshFileList]);

  const refreshFiles = useCallback(() => {
    getListOfFiles().then();
  }, [getListOfFiles]);

  // Clear the visible error after the user has had time to read it.
  useEffect(() => {
    if (errorMessage) {
      const timer = setTimeout(() => {
        setErrorMessage('');
      }, 6000);

      // Clear the timer if the component unmounts
      return () => clearTimeout(timer);
    }
  }, [errorMessage]);

  if (!isLoaded || !fileRows) {
    return <LoadingFiles currentPlot={currentPlot} currentCensus={currentCensus} refreshFiles={refreshFiles} />;
  } else {
    const sortedFileData: UploadedFileData[] = fileRows.toSorted((a, b) => new Date(b.date ? b.date : '').getTime() - new Date(a.date ? a.date : '').getTime());
    let i = 1;
    sortedFileData.forEach(row => {
      row.key = i;
      i++;
    });
    const sortedFileTextCSV = sortedFileData.filter(row => row.name.toLowerCase().endsWith('.csv') || row.name.toLowerCase().endsWith('.txt'));
    const sortedFileArcGIS = sortedFileData.filter(row => row.name.toLowerCase().endsWith('.xlsx'));
    return (
      <>
        {/*CSV FILES*/}
        <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column', mb: 10 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            <Typography level={'title-lg'} marginBottom={2}>
              Files uploaded to {currentPlot?.plotName ?? 'this plot'}, census {currentCensus?.plotCensusNumber ?? '—'}
            </Typography>
            <Typography level="body-sm" sx={{ mb: 2, maxWidth: 760 }}>
              This page lists source files still available in storage. A completed upload can remain in Recent Changes after its source file has been deleted or
              expired.
            </Typography>
            <Button variant={'contained'} sx={{ width: 'fit-content', marginBottom: 2 }} onClick={refreshFiles}>
              Refresh Files
            </Button>
            <Typography level={'title-lg'}>Stored source files</Typography>
            {errorMessage && (
              <Alert color="danger" sx={{ mt: 1 }}>
                Could not load stored files: {errorMessage}
              </Alert>
            )}
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', marginTop: 1 }}>
            <TableContainer component={Paper}>
              <Table aria-label={'Stored files'} stickyHeader size={'medium'}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={tableHeaderSettings}>File Count</TableCell>
                    {fileColumns.map(item => (
                      <TableCell key={item.key} sx={tableHeaderSettings}>
                        {item.label}
                      </TableCell>
                    ))}
                    <TableCell sx={tableHeaderSettings}>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sortedFileTextCSV.length === 0 && sortedFileArcGIS.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={fileColumns.length + 2} align="center">
                        No source files are currently available in storage. Check Recent Changes for completed upload history.
                      </TableCell>
                    </TableRow>
                  ) : (
                    <>
                      {sortedFileTextCSV.map(row => {
                        return (
                          <TableRow key={row.key}>
                            <TableCell>{row.key}</TableCell>
                            <TableCell>{row.name}</TableCell>
                            <TableCell>{row.user}</TableCell>
                            <TableCell>{row.formType}</TableCell>
                            <TableCell>{row.fileErrors || '—'}</TableCell>
                            <TableCell>{formatDisplayDate(row.date)}</TableCell>
                            <TableCell align="center">
                              <Button startIcon={<DownloadIcon />} onClick={() => handleDownload(row.name)}>
                                Download
                              </Button>
                              <Button color="error" startIcon={<DeleteIcon />} onClick={() => handleDelete(row.name)}>
                                Delete
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {sortedFileArcGIS.map(row => {
                        return (
                          <TableRow key={row.key}>
                            <TableCell>{row.key}</TableCell>
                            <TableCell>{row.name}</TableCell>
                            <TableCell>{row.user}</TableCell>
                            <TableCell>{row.formType}</TableCell>
                            <TableCell>{row.fileErrors || '—'}</TableCell>
                            <TableCell>{formatDisplayDate(row.date)}</TableCell>
                            <TableCell align="center">
                              <Button startIcon={<DownloadIcon />} onClick={() => handleDownload(row.name)}>
                                Download
                              </Button>
                              <Button color="error" startIcon={<DeleteIcon />} onClick={() => handleDelete(row.name)}>
                                Delete
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        </Box>
      </>
    );
  }
}
