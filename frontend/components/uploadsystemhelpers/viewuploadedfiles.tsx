"use client";
import React, {Dispatch, SetStateAction, useCallback, useEffect, useState} from 'react';
import {fileColumns, Plot, tableHeaderSettings, UploadedFileData} from "@/config/macros";
import {BrowseError} from "@/app/error"
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
import {CensusRDS} from "@/config/sqlmacros";
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
        Container: {currentPlot?.key.trim() ?? 'none'}-{currentCensus?.plotCensusNumber?.toString() ?? 'none'}
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
            <CircularProgress size={"lg"} color={"danger"} variant={"soft"} />
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
  const [error, setError] = useState<Error>();
  const [isLoaded, setIsLoaded] = useState(false);
  const [fileRows, setFileRows] = useState<UploadedFileData[]>();
  const handleDownload = async (containerName: string, filename: string) => {
    try {
      const response = await fetch(`/api/downloadfile?container=${containerName}&filename=${encodeURIComponent(filename)}`);
      if (!response.ok) throw new Error('Error getting download link');

      const data = await response.json();
      window.location.href = data.url; // Navigates to the pre-signed URL
    } catch (error) {
      console.error('Download error:', error);
    }
  };

  const handleDelete = async (containerName: string, filename: string) => {
    try {
      const response = await fetch(`/api/deletefile?container=${containerName}&filename=${encodeURIComponent(filename)}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Error deleting file');

      // Refresh the file list after successful deletion
      setRefreshFileList(true);
    } catch (error: any) {
      console.error('Delete error:', error);
      setError(error);
    }
  };

  const getListOfFiles = useCallback(async () => {
    try {
      let response = await fetch(`/api/downloadallfiles?plot=${currentPlot?.key.trim() ?? 'none'}&census=${currentCensus?.plotCensusNumber?.toString().trim() ?? 'none'}`, {
        method: 'GET',
      });

      if (!response.ok) {
        let jsonOutput = await response.json();
        console.error('response.statusText', jsonOutput.statusText);
        setError(new Error(`API response: ${jsonOutput.statusText}`));
      } else {
        console.log(response.status + ", " + response.statusText);
        let data = await response.json();
        setFileRows(data.blobData);
        setIsLoaded(true);
      }
    } catch (error: any) {
      setError(error)
      console.log(error.message);
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

  if (error) {
    console.log(error);
    return BrowseError(error);
  } else if (!isLoaded || !fileRows) {
    return <LoadingFiles currentPlot={currentPlot} currentCensus={currentCensus} refreshFiles={refreshFiles}/>
  } else {
    let sortedFileData: UploadedFileData[] = fileRows;
    if (fileRows.length > 1) sortedFileData.toSorted((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    let i = 1;
    sortedFileData.forEach((row) => {
      row.key = i;
      i++;
    })
    return (
      <>
        {/*CSV FILES*/}
        <Box sx={{display: 'flex', flex: 1, flexDirection: "column", mb: 10}}>
          <Box sx={{display: 'flex', flexDirection: "column"}}>
            <Typography level={"title-lg"}>
              Accessing
              Container: {currentPlot?.key.trim() ?? 'none'}-{currentCensus?.plotCensusNumber?.toString() ?? 'none'}
            </Typography>
            <Button sx={{width: 'fit-content', marginBottom: 5}} onClick={refreshFiles}>Refresh Files</Button>
            <Typography level={"title-lg"}>
              Uploaded CSV Files
            </Typography>
          </Box>
          <Divider className={"mt-6 mb-6"}/>
          <Box sx={{display: 'flex', flexDirection: "column"}}>
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
                  {sortedFileData.filter((row) => row.name.toLowerCase()).map((row) => {
                    let errs = row.errors == "false";
                    return (
                      <TableRow key={row.key}>
                        <TableCell sx={(errs) ? {color: 'red', fontWeight: 'bold'} : {}}>{row.key}</TableCell>
                        <TableCell sx={(errs) ? {color: 'red', fontWeight: 'bold'} : {}}>{row.name}</TableCell>
                        <TableCell sx={(errs) ? {color: 'red', fontWeight: 'bold'} : {}}>{row.user}</TableCell>
                        <TableCell sx={(errs) ? {
                          color: 'red',
                          fontWeight: 'bold'
                        } : {}}>{new Date(row.date).toString()}</TableCell>
                        <TableCell sx={(errs) ? {
                          color: 'red',
                          fontWeight: 'bold'
                        } : {}}>{row.version}</TableCell>
                        <TableCell sx={(errs) ? {
                          color: 'red',
                          fontWeight: 'bold'
                        } : {}}>{row.isCurrentVersion ? 'YES' : ''}</TableCell>
                        <TableCell align="center">
                          <Button
                            onClick={() => handleDownload(`${currentPlot?.key.trim() ?? 'none'}-${currentCensus?.plotCensusNumber?.toString().trim() ?? 'none'}`, row.name)}>
                            <DownloadIcon/>
                          </Button>
                          <Button
                            onClick={() => handleDelete(`${currentPlot?.key.trim() ?? 'none'}-${currentCensus?.plotCensusNumber?.toString().trim() ?? 'none'}`, row.name)}>
                            <DeleteIcon/>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        </Box>
        {/*  ARCGIS FILES */}
        <Box sx={{display: 'flex', flex: 1, flexDirection: "column"}}>
          <Box sx={{display: 'flex', flexDirection: "column"}}>
            <Typography level={"title-lg"}>
              Uploaded ArcGIS Files
            </Typography>
          </Box>
          <Divider className={"mt-6 mb-6"}/>
          <Box sx={{display: 'flex', flexDirection: "column"}}>
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
                  {sortedFileData.filter((row) => row.name.toLowerCase().endsWith('.xlsx')).map((row) => {
                    let errs = row.errors == "false";
                    return (
                      <TableRow key={row.key}>
                        <TableCell sx={(errs) ? {color: 'red', fontWeight: 'bold'} : {}}>{row.key}</TableCell>
                        <TableCell sx={(errs) ? {color: 'red', fontWeight: 'bold'} : {}}>{row.name}</TableCell>
                        <TableCell sx={(errs) ? {color: 'red', fontWeight: 'bold'} : {}}>{row.user}</TableCell>
                        <TableCell sx={(errs) ? {
                          color: 'red',
                          fontWeight: 'bold'
                        } : {}}>{new Date(row.date).toString()}</TableCell>
                        <TableCell sx={(errs) ? {
                          color: 'red',
                          fontWeight: 'bold'
                        } : {}}>{new Date(row.version).toString()}</TableCell>
                        <TableCell sx={(errs) ? {
                          color: 'red',
                          fontWeight: 'bold'
                        } : {}}>{row.isCurrentVersion ? 'YES' : ''}</TableCell>
                        <TableCell align="center">
                          <Button
                            onClick={() => handleDownload(`${currentPlot?.key.trim() ?? 'none'}-${currentCensus?.plotCensusNumber?.toString().trim() ?? 'none'}`, row.name)}>
                            <DownloadIcon/>
                          </Button>
                          <Button>
                            <EditIcon/>
                          </Button>
                          <Button
                            onClick={() => handleDelete(`${currentPlot?.key.trim() ?? 'none'}-${currentCensus?.plotCensusNumber?.toString().trim() ?? 'none'}`, row.name)}>
                            <DeleteIcon/>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        </Box>
      </>
    );
  }
}