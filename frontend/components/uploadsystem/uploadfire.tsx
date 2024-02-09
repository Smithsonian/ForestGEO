"use client";
import React, {useEffect, useState} from 'react';
import {Box, Button, LinearProgress, LinearProgressProps, Typography} from '@mui/material';
import {FileCollectionRowSet, ReviewStates, UploadFireProps} from '@/config/macros';
import {FileWithPath} from "react-dropzone";
import {Stack} from "@mui/joy";

const UploadFire: React.FC<UploadFireProps> = ({
                                                 acceptedFiles, parsedData,
                                                 uploadForm, setIsDataUnsaved,
                                                 currentPlot, currentCensus, uploadCompleteMessage,
                                                 setUploadCompleteMessage, handleReturnToStart,
                                                 user, setUploadError, setErrorComponent, setReviewState
                                               }) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [results, setResults] = useState<string[]>([]);
  const [totalOperations, setTotalOperations] = useState(0);
  const [completedOperations, setCompletedOperations] = useState<number>(0);
  const [currentlyRunning, setCurrentlyRunning] = useState("");

  const uploadToSql = async (fileData: FileCollectionRowSet, fileName: string) => {
    try {
      setCurrentlyRunning(`File ${fileName} uploading to SQL...`)
      const response = await fetch(
        `/api/sqlload?formType=${uploadForm}&fileName=${fileName}&plot=${currentPlot?.key.trim()}&census=${currentCensus?.censusID ? currentCensus.censusID.toString().trim() : 0}&user=${user}`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(fileData[fileName])
        });
      // Increment completedOperations when an operation is completed
      setCompletedOperations((prevCompleted) => prevCompleted + 1);
      return response.ok ? 'SQL load successful' : 'SQL load failed';
    } catch (error) {
      setUploadError(error);
      setErrorComponent('UploadFire');
      setReviewState(ReviewStates.ERRORS);
    }
  };

  const uploadToStorage = async (file: FileWithPath) => {
    try {
      setCurrentlyRunning(`File ${file.name} uploading to Azure Storage...`)
      const formData = new FormData();
      formData.append(file.name, file);

      const response = await fetch(
        `/api/storageload?fileName=${file.name}&plot=${currentPlot?.key.trim()}&census=${currentCensus?.censusID ? currentCensus.censusID.toString().trim() : 0}&user=${user}`, {
          method: 'POST',
          body: formData
        });
      // Increment completedOperations when an operation is completed
      setCompletedOperations((prevCompleted) => prevCompleted + 1);
      return response.ok ? 'Storage load successful' : 'Storage load failed';
    } catch (error) {
      setUploadError(error);
      setErrorComponent('UploadFire');
      setReviewState(ReviewStates.ERRORS);
    }
  };

  function LinearProgressWithLabel(props: LinearProgressProps & { value: number, currentlyRunningMsg: string }) {
    return (
      <Box sx={{display: 'flex', alignItems: 'center'}}>
        <Box sx={{width: '100%', mr: 1}}>
          <LinearProgress variant="determinate" {...props} />
        </Box>
        <Box sx={{minWidth: 35}}>
          <Typography variant="body2" color="text.secondary">{`${Math.round(
            props.value,
          )}% --> ${props.currentlyRunningMsg}`}</Typography>
        </Box>
      </Box>
    );
  }

  useEffect(() => {
    switch (uploadForm) {
      case "fixeddata_codes.csv":
        setUploadCompleteMessage("Please visit the Attributes view in the Properties menu to review your changes!");
        break;
      case "fixeddata_role.csv":
      case "fixeddata_personnel.csv":
        setUploadCompleteMessage("Please visit the Personnel view in the Properties menu to review your changes!");
        break;
      case "fixeddata_species.csv":
        setUploadCompleteMessage("Please visit the Species view in the Properties menu to review your changes!");
        break;
      case "fixeddata_quadrat.csv":
        setUploadCompleteMessage("Please visit the Quadrats view in the Properties menu to review your changes!");
        break;
      case "fixeddata_census.csv":
      case "ctfsweb_new_plants_form":
      case "ctfsweb_old_tree_form":
      case "ctfsweb_multiple_stems_form":
      case "ctfsweb_big_trees_form":
        setUploadCompleteMessage("Please visit the CoreMeasurements view to review your changes!");
        break;
      default:
        setUploadCompleteMessage("");
        break;
    }
    const calculateTotalOperations = () => {
      let totalOps = 0;

      for (const _file of acceptedFiles) {
        // Increment totalOps for each file and each operation (SQL and storage)
        totalOps += 2;
      }

      // Set the total number of operations
      setTotalOperations(totalOps);
    };

    const uploadFiles = async () => {
      const uploadResults: string[] = [];

      // Calculate the total number of operations
      calculateTotalOperations();

      for (const file of acceptedFiles) {
        const sqlResult = await uploadToSql(parsedData, file.name);
        const storageResult = await uploadToStorage(file);
        uploadResults.push(`File: ${file.name}, SQL: ${sqlResult}, Storage: ${storageResult}`);
      }

      setResults(uploadResults);
      setLoading(false);
      setIsDataUnsaved(false);
    };

    uploadFiles().catch(console.error);
  }, [acceptedFiles, parsedData, uploadForm, setIsDataUnsaved]);

  return (
    <>
      {loading ? (
        <Box sx={{display: 'flex', flex: 1, width: '100%', alignItems: 'center', mt: 4}}>
          <Stack direction={"column"}>
            <Typography variant="h6" gutterBottom>{`Total Operations: ${totalOperations}`}</Typography>
            <LinearProgressWithLabel variant={"determinate"} value={(completedOperations / totalOperations) * 100}
                                     currentlyRunningMsg={currentlyRunning}/>
          </Stack>
        </Box>
      ) : (
        <Box sx={{display: 'flex', flex: 1, width: '100%', alignItems: 'center', mt: 4}}>
          <Stack direction={"column"}>
            <Typography variant="h5" gutterBottom>Upload Complete</Typography>
            {results.map((result) => (
              <Typography key={result}>{result}</Typography>
            ))}
            <Typography>{uploadCompleteMessage}</Typography>
            <Button onClick={handleReturnToStart} sx={{width: 'fit-content'}}>
              Return to Upload Start
            </Button>
          </Stack>
        </Box>
      )}
    </>
  );
};

export default UploadFire;
