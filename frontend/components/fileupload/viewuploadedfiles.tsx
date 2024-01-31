"use client";
import React, {useCallback, useEffect, useState} from 'react';
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
function LoadingFiles() {
  return (
    <Card className="flex flex-col items-center justify-center gap-4 py-8 md:py-10">
      <CardHeader>
        <div className="flex flex-col">
          <h5 className="text-md">Loading Files...</h5>
        </div>
      </CardHeader>
      <Divider className={"mt-6 mb-6"}/>
      <CardContent>
        <div className="flex flex-col">
          <CircularProgress value={60} size={"lg"}>
            Retrieving files...
          </CircularProgress>
        </div>
      </CardContent>
    </Card>
  );
}

interface VUFProps {
  currentPlot: Plot | null;
  currentCensus: CensusRDS | null;
}

export default function ViewUploadedFiles({currentPlot, currentCensus}: Readonly<VUFProps>) {
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
      await getListOfFiles();
    } catch (error: any) {
      console.error('Delete error:', error);
      setError(error);
    }
  };

  const getListOfFiles = useCallback(async () => {
    try {
      let response = await fetch(`/api/downloadallfiles?plot=${currentPlot?.key.trim() ?? 'none'}&census=${currentCensus?.censusID.toString().trim() ?? 'none'}`, {
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
    if (currentPlot) {
      getListOfFiles().then();
    }
  }, [getListOfFiles, currentPlot]);

  if (error) {
    console.log(error);
    return BrowseError(error);
  } else if (!isLoaded || !fileRows) {
    return <LoadingFiles/>
  } else {
    let sortedFileData = fileRows.toSorted((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
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
              Container: {currentPlot?.key.trim() ?? 'none'}-{currentCensus?.censusID.toString() ?? 'none'}
              <br/> <br/>
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
                  {sortedFileData.filter((row) => row.name.toLowerCase().endsWith('.csv')).map((row) => {
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
                          <Button onClick={() => handleDownload(`${currentPlot?.key.trim() ?? 'none'}-${currentCensus?.censusID.toString().trim() ?? 'none'}`, row.name)}>
                            <DownloadIcon/>
                          </Button>
                          <Button onClick={() => handleDelete(`${currentPlot?.key.trim() ?? 'none'}-${currentCensus?.censusID.toString().trim() ?? 'none'}`, row.name)}>
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
                          <Button onClick={() => handleDownload(`${currentPlot?.key.trim() ?? 'none'}-${currentCensus?.censusID.toString().trim() ?? 'none'}`, row.name)}>
                            <DownloadIcon/>
                          </Button>
                          <Button>
                            <EditIcon/>
                          </Button>
                          <Button onClick={() => handleDelete(`${currentPlot?.key.trim() ?? 'none'}-${currentCensus?.censusID.toString().trim() ?? 'none'}`, row.name)}>
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