"use client";
import React, {Dispatch, SetStateAction, useCallback, useEffect, useState} from 'react';
import {tableHeaderSettings} from "@/config/macros";
import {fileColumns} from "@/config/macros/formdetails";
import {UploadedFileData} from "@/config/macros/formdetails";
import {Plot} from "@/config/sqlrdsdefinitions/tables/plotrds";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow
} from "@mui/material";
import {DeleteIcon, DownloadIcon, EditIcon} from "@/components/icons";
import Divider from "@mui/joy/Divider";
import CircularProgress from "@mui/joy/CircularProgress";
import Box from "@mui/joy/Box";
import Typography from "@mui/joy/Typography";
import {CensusRDS} from '@/config/sqlrdsdefinitions/tables/censusrds';
// @todo: look into using an ID other than plot name.
// @todo: react router URL params to pass in the ID for Browse.
// https://reactrouter.com/en/main/start/tutorial#url-params-in-loaders
interface LoadingFilesProps {
  currentPlot: Plot | null;
  currentCensus: CensusRDS | null;
  refreshFiles: () => void;
}

function LoadingFiles(props: Readonly<LoadingFilesProps>) {
  const {currentPlot, currentCensus, refreshFiles} = props;
  useEffect(() => {
    refreshFiles();
  }, []); // on mount

  return (
    <Box sx={{display: 'flex', flexDirection: "column"}}>
      <Typography level={"title-lg"}>
        Accessing
        Container: {currentPlot?.plotName?.trim() ?? 'none'}-{currentCensus?.plotCensusNumber?.toString() ?? 'none'}
        <br/>
        <Button sx={{width: 'fit-content'}} onClick={refreshFiles}>Refresh Files</Button>
        <br/>
        Uploaded CSV Files
      </Typography>
      <Card className="flex flex-col items-center justify-center gap-4 py-8 md:py-10">
        <CardHeader>
          <div className="flex flex-col">
            <h5 className="text-md">Loading Files...</h5>
          </div>
        </CardHeader>
        <Divider className={"mt-6 mb-6"}/>
        <CardContent>
          <Box sx={{display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
            <CircularProgress size={"lg"} color={"danger"} variant={"soft"}/>
            <Typography variant={"soft"} color={"warning"}>Retrieving files...</Typography>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}

interface VUFProps {
  currentPlot: Plot | null;
  currentCensus: CensusRDS | null;
  refreshFileList: boolean;
  setRefreshFileList: Dispatch<SetStateAction<boolean>>;
}

export default function ViewUploadedFiles(props: Readonly<VUFProps>) {
  const {currentPlot, currentCensus, refreshFileList, setRefreshFileList} = props;
  const [isLoaded, setIsLoaded] = useState(false);
  const [fileRows, setFileRows] = useState<UploadedFileData[]>();
  const [openSnackbar, setOpenSnackbar] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleDownload = async (containerName: string, filename: string) => {
    try {
      const response = await fetch(`/api/filehandlers/downloadfile?container=${containerName.toLowerCase()}&filename=${encodeURIComponent(filename)}`);
      if (!response.ok) throw new Error('Error getting download link');

      const data = await response.json();
      window.location.href = data.url; // Navigates to the pre-signed URL
    } catch (error: any) {
      console.error('Download error:', error);
      setErrorMessage(error.message); // Set the error message
      setOpenSnackbar(true); // Open the snackbar
    }
  };

  const handleDelete = async (containerName: string, filename: string) => {
    try {
      const response = await fetch(`/api/filehandlers/deletefile?container=${containerName.toLowerCase()}&filename=${encodeURIComponent(filename)}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Error deleting file');

      // Refresh the file list after successful deletion
      setRefreshFileList(true);
    } catch (error: any) {
      console.error('Delete error:', error);
      setErrorMessage(error.message); // Set the error message
      setOpenSnackbar(true); // Open the snackbar
    }
  };

  const getListOfFiles = useCallback(async () => {
    try {
      const response = await fetch(`/api/filehandlers/downloadallfiles?plot=${currentPlot?.plotName?.trim() ?? 'none'}&census=${currentCensus?.plotCensusNumber?.toString().trim() ?? 'none'}`, {
        method: 'GET',
      });

      if (!response.ok) {
        const jsonOutput = await response.json();
        console.error('response.statusText', jsonOutput.statusText);
        setErrorMessage(`API response: ${jsonOutput.statusText}`);
      } else {
        console.log(response.status + ", " + response.statusText);
        const data = await response.json();
        setFileRows(data.blobData);
        setIsLoaded(true);
      }
    } catch (error: any) {
      console.log(error.message);
      setErrorMessage(error.message); // Set the error message
      setOpenSnackbar(true); // Open the snackbar
    }
  }, [currentPlot, currentCensus]);

  useEffect(() => {
    if (refreshFileList && currentPlot && currentCensus) {
      getListOfFiles().then(() => setRefreshFileList(false)); // Reset the refresh trigger after loading
    }
  }, [refreshFileList, currentPlot, currentCensus, getListOfFiles, setRefreshFileList]);

  const refreshFiles = () => {
    getListOfFiles().then();
  };

  const handleCloseSnackbar = () => {
    setOpenSnackbar(false);
  };

  // useEffect to refresh file list on error and reset the error message
  useEffect(() => {
    if (errorMessage) {
      // Refresh the file list
      refreshFiles();

      // Reset the error message after a short delay
      // This delay ensures that the user has enough time to see the error message
      const timer = setTimeout(() => {
        setErrorMessage('');
      }, 6000); // Adjust the delay as needed

      // Clear the timer if the component unmounts
      return () => clearTimeout(timer);
    }
  }, [errorMessage]);

  if (!isLoaded || !fileRows) {
    return <LoadingFiles currentPlot={currentPlot} currentCensus={currentCensus} refreshFiles={refreshFiles}/>;
  } else {
    const sortedFileData: UploadedFileData[] = fileRows;
    if (fileRows.length > 1) sortedFileData.toSorted((a, b) => new Date(b.date ? b.date : '').getTime() - new Date(a.date ? a.date : '').getTime());
    let i = 1;
    sortedFileData.forEach((row) => {
      row.key = i;
      i++;
    });
    const sortedFileTextCSV = sortedFileData.filter((row) => row.name.toLowerCase().endsWith('.csv') ||
      row.name.toLowerCase().endsWith('.txt'));
    const sortedFileArcGIS = sortedFileData.filter((row) => row.name.toLowerCase().endsWith('.xlsx'));
    return (
      <>
        {/*CSV FILES*/}
        <Box sx={{display: 'flex', flex: 1, flexDirection: "column", mb: 10}}>
          <Box sx={{display: 'flex', flexDirection: "column"}}>
            <Typography level={"title-lg"} marginBottom={2}>
              Accessing
              Container: {currentPlot?.plotName?.trim() ?? 'none'}-{currentCensus?.plotCensusNumber?.toString() ?? 'none'}
            </Typography>
            <Button variant={"contained"} sx={{width: 'fit-content', marginBottom: 2}}
                    onClick={refreshFiles}>Refresh
              Files</Button>
            <Typography level={"title-lg"}>
              Uploaded CSV Files
            </Typography>
          </Box>
          <Box sx={{display: 'flex', flexDirection: "column", marginTop: 1}}>
            <TableContainer component={Paper}>
              <Table aria-label={"Stored files"} stickyHeader size={"medium"}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={tableHeaderSettings}>File Count</TableCell>
                    {fileColumns.map((item) => (
                      <TableCell key={item.key} sx={tableHeaderSettings}>{item.label}</TableCell>
                    ))}
                    <TableCell sx={tableHeaderSettings}>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sortedFileTextCSV.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={fileColumns.length + 2} align="center">
                        No data available
                      </TableCell>
                    </TableRow>
                  ) : (
                    sortedFileTextCSV.map((row) => {
                      // let errs = row.errors == "false";
                      const errs = false;
                      return (
                        <TableRow key={row.key}>
                          <TableCell sx={(errs) ? {
                            color: 'red',
                            fontWeight: 'bold'
                          } : {}}>{row.key}</TableCell>
                          <TableCell sx={(errs) ? {
                            color: 'red',
                            fontWeight: 'bold'
                          } : {}}>{row.name}</TableCell>
                          <TableCell sx={(errs) ? {
                            color: 'red',
                            fontWeight: 'bold'
                          } : {}}>{row.user}</TableCell>
                          <TableCell sx={(errs) ? {
                            color: 'red',
                            fontWeight: 'bold'
                          } : {}}>{row.formType}</TableCell>
                          <TableCell sx={(errs) ? {
                            color: 'red',
                            fontWeight: 'bold'
                          } : {}}>{row.fileErrors}</TableCell>
                          <TableCell sx={(errs) ? {
                            color: 'red',
                            fontWeight: 'bold'
                          } : {}}>{new Date(row.date ? row.date : '').toString()}</TableCell>
                          <TableCell align="center">
                            <Button
                              onClick={() => handleDownload(`${currentPlot?.plotName?.trim() ?? 'none'}-${currentCensus?.plotCensusNumber?.toString().trim() ?? 'none'}`, row.name)}>
                              <DownloadIcon/>
                            </Button>
                            <Button
                              onClick={() => handleDelete(`${currentPlot?.plotName?.trim() ?? 'none'}-${currentCensus?.plotCensusNumber?.toString().trim() ?? 'none'}`, row.name)}>
                              <DeleteIcon/>
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                  {sortedFileArcGIS.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={fileColumns.length + 2} align="center">
                        No data available
                      </TableCell>
                    </TableRow>
                  ) : (
                    sortedFileArcGIS.map((row) => {
                      const errs = "false";
                      return (
                        <TableRow key={row.key}>
                          <TableCell sx={(errs) ? {
                            color: 'red',
                            fontWeight: 'bold'
                          } : {}}>{row.key}</TableCell>
                          <TableCell sx={(errs) ? {
                            color: 'red',
                            fontWeight: 'bold'
                          } : {}}>{row.name}</TableCell>
                          <TableCell sx={(errs) ? {
                            color: 'red',
                            fontWeight: 'bold'
                          } : {}}>{row.user}</TableCell>
                          <TableCell sx={(errs) ? {
                            color: 'red',
                            fontWeight: 'bold'
                          } : {}}>{new Date(row.date ? row.date : '').toString()}</TableCell>
                          <TableCell sx={(errs) ? {
                            color: 'red',
                            fontWeight: 'bold'
                          } : {}}>{row.formType}</TableCell>
                          <TableCell sx={(errs) ? {
                            color: 'red',
                            fontWeight: 'bold'
                          } : {}}>{row.fileErrors}</TableCell>
                          <TableCell align="center">
                            <Button
                              onClick={() => handleDownload(`${currentPlot?.plotName?.trim() ?? 'none'}-${currentCensus?.plotCensusNumber?.toString().trim() ?? 'none'}`, row.name)}>
                              <DownloadIcon/>
                            </Button>
                            <Button>
                              <EditIcon/>
                            </Button>
                            <Button
                              onClick={() => handleDelete(`${currentPlot?.plotName?.trim() ?? 'none'}-${currentCensus?.plotCensusNumber?.toString().trim() ?? 'none'}`, row.name)}>
                              <DeleteIcon/>
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
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