"use client";
import React, {useCallback, useEffect, useState} from 'react';
import {fileColumns, tableHeaderSettings, UploadedFileData} from "@/config/macros";
import {title} from "@/config/primitives";
import {BrowseError} from "@/app/error"
import {usePlotContext} from "@/app/contexts/plotcontext";
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
// @todo: look into using an ID other than plot name.
// @todo: react router URL params to pass in the ID for Browse.
// https://reactrouter.com/en/main/start/tutorial#url-params-in-loaders
function LoadingFiles() {
  return (
    <>
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
    </>
  );
}

export default function ViewUploadedFiles() {
  let localPlot = usePlotContext();
  const [error, setError] = useState<Error>();
  const [isLoaded, setIsLoaded] = useState(false);
  const [fileRows, setFileRows] = useState<UploadedFileData[]>();
  // const [deleteFile, setDeleteFile] = useState("");
  const getListOfFiles = useCallback(async () => {
    if (localPlot && localPlot.key !== undefined) {
      let response = null;
      try {
        response = await fetch('/api/downloadallfiles?plot=' + localPlot.key, {
          method: 'GET',
        });
        
        if (!response.ok) {
          console.error('response.statusText', response.statusText);
          setError(new Error('API response not ok'));
        }
      } catch (e) {
        console.error(e);
        setError(new Error('API response not ok'));
      }
      
      if (response) {
        let data = await response.json();
        setFileRows(data.blobData);
        setIsLoaded(true);
      }
    } else {
      console.log('Plot is undefined');
      setError(new Error('No plot'));
    }
  }, [localPlot]);
  
  useEffect(() => {
    getListOfFiles().then();
  }, [getListOfFiles]);
  
  // File Deletion system --> need to reformat the table for selection, etc.
  // const deleteFileByName = useCallback(async () => {
  //   if (deleteFile !== '') {
  //     const response = await fetch('/api/deletefilebyname?plot=' + localPlot!.key + '&filename=' + deleteFile, {
  //       method: 'DELETE',
  //     });
  //     let data = await response.json();
  //     const blobResponse = data.blobResponse;
  //     if (!blobResponse.errorCode) {
  //       console.log(`deleted blob ${deleteFile}`);
  //     }
  //   }
  // }, [deleteFile, localPlot]);
  //
  // useEffect(() => {
  //   if (deleteFile != '') {
  //     deleteFileByName()
  //       .catch(console.error)
  //       .then(() => setDeleteFile(''));
  //   }
  // }, [deleteFile, setDeleteFile, deleteFileByName]);
  
  if ((!localPlot || !localPlot.key)) {
    return (
      <>
        <h1 className={title()}>Please select a plot to continue.</h1>
      </>
    );
  } else if (error) {
    return <BrowseError/>
  } else if (!isLoaded || !fileRows) {
    return <LoadingFiles/>
  } else {
    let sortedFileData = fileRows!.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    let i = 1;
    sortedFileData.forEach((row) => {
      row.key = i;
      i++;
    })
    return (
      <>
        <Box sx={{display: 'flex', flexDirection: "column"}}>
          <Box sx={{display: 'flex', flexDirection: "column"}}>
            <Typography level={"title-lg"}>
              Uploaded Files
            </Typography>
          </Box>
          <Divider className={"mt-6 mb-6"}/>
          <Box sx={{display: 'flex', flexDirection: "column"}}>
            <TableContainer component={Paper}>
              <Table aria-label={"Stored files"} stickyHeader size={"medium"}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={tableHeaderSettings}>File Count</TableCell>
                    {fileColumns.map((item, index) => (
                      <TableCell key={index} sx={tableHeaderSettings}>{item.label}</TableCell>
                    ))}
                    <TableCell sx={tableHeaderSettings}>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sortedFileData!.map((row, index) => {
                    let errs = row.errors == "false";
                    return (
                      <>
                        <TableRow key={index}>
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
                            <Button>
                              <DownloadIcon/>
                            </Button>
                            <Button>
                              <EditIcon/>
                            </Button>
                            <Button> {/*<Button onClick={() => setDeleteFile(row.name)}>*/}
                              <DeleteIcon/>
                            </Button>
                          </TableCell>
                        </TableRow>
                      </>
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