"use client";
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Box, Button, LinearProgress, LinearProgressProps, Typography} from '@mui/material';
import {FileCollectionRowSet, FileRow, formatDate, ReviewStates, UploadFireProps} from '@/config/macros';
import {FileWithPath} from "react-dropzone";
import {Stack} from "@mui/joy";
import {CMIDRow, DetailedCMIDRow} from "@/components/uploadsystem/uploadparent";
import {LinearProgressWithLabel} from "@/components/client/clientmacros";

interface IDToRow {
  coreMeasurementID: number;
  fileRow: FileRow;
}

const UploadFire: React.FC<UploadFireProps> = ({
                                                 personnelRecording, acceptedFiles, parsedData,
                                                 uploadForm, setIsDataUnsaved,
                                                 currentPlot, currentCensus, uploadCompleteMessage,
                                                 setUploadCompleteMessage, handleReturnToStart,
                                                 user, setUploadError,
                                                 setErrorComponent,
                                                 setReviewState,
                                                 allRowToCMID, setAllRowToCMID,
                                               }) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [results, setResults] = useState<string[]>([]);
  const [totalOperations, setTotalOperations] = useState(0);
  const [completedOperations, setCompletedOperations] = useState<number>(0);
  const [currentlyRunning, setCurrentlyRunning] = useState("");
  const hasUploaded = useRef(false);

  const uploadToSql = useCallback(async (fileData: FileCollectionRowSet, fileName: string) => {
    try {
      setCurrentlyRunning(`File ${fileName} uploading to SQL...`);
      const response = await fetch(
        `/api/sqlload?formType=${uploadForm}&fileName=${fileName}&plot=${currentPlot?.id.toString().trim()}&census=${currentCensus?.censusID ? currentCensus.censusID.toString().trim() : 0}&user=${personnelRecording}`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(fileData[fileName])
        });
      setCompletedOperations((prevCompleted) => prevCompleted + 1);
      const result = await response.json();
      if (uploadForm === 'fixeddata_census' && result.idToRows) {
        // Fetch additional details for each coreMeasurementID
        Promise.all(result.idToRows.map(({ coreMeasurementID }: IDToRow) =>
          fetch(`/api/cmiddetails?cmid=${coreMeasurementID}`)
            .then(response => response.json())
        )).then(details => {
          // Combine details with idToRows data
          const newRowToCMID: DetailedCMIDRow[] = result.idToRows.map(({ coreMeasurementID, fileRow }: IDToRow, index: number) => {
            const detailArray = details[index];
            if (Array.isArray(detailArray) && detailArray.length > 0) {
              const detail = detailArray[0]; // Extract the object from the array
              if ('plotName' in detail &&
                'quadratName' in detail &&
                'plotCensusNumber' in detail &&
                'censusStart' in detail &&
                'censusEnd' in detail &&
                'personnelName' in detail &&
                'speciesName' in detail) {
                return {
                  coreMeasurementID,
                  fileName,
                  row: fileRow,
                  plotName: detail.plotName,
                  quadratName: detail.quadratName,
                  plotCensusNumber: detail.plotCensusNumber,
                  censusStart: formatDate(detail.censusStart),
                  censusEnd: formatDate(detail.censusEnd),
                  personnelName: detail.personnelName,
                  speciesName: detail.speciesName
                };
              } else {
                throw new Error('Detail object missing required properties');
              }
            } else {
              throw new Error('Invalid detail array structure');
            }
          });
          setAllRowToCMID(prevState => [...prevState, ...newRowToCMID]);
        }).catch(error => {
          console.error('Error fetching CMID details:', error);
          setUploadError(error);
          setErrorComponent('UploadFire');
          setReviewState(ReviewStates.ERRORS);
        });
      }
      return response.ok ? 'SQL load successful' : 'SQL load failed';
    } catch (error) {
      setUploadError(error);
      setErrorComponent('UploadFire');
      setReviewState(ReviewStates.ERRORS);
    }
  }, [uploadForm, currentPlot?.id, currentCensus?.censusID, personnelRecording, setAllRowToCMID, setUploadError, setErrorComponent, setReviewState]);


  const uploadToStorage = useCallback(async (file: FileWithPath) => {
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
  }, [currentCensus?.censusID, currentPlot?.key, setErrorComponent, setReviewState, setUploadError, user]);

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

      console.log(`uploadfire acceptedfiles length: ${acceptedFiles.length}`);

      for (const file of acceptedFiles) {
        console.log(`file: ${file.name}`);
        const sqlResult = await uploadToSql(parsedData, file.name);
        const storageResult = await uploadToStorage(file);
        uploadResults.push(`File: ${file.name}, SQL: ${sqlResult}, Storage: ${storageResult}`);
      }

      setResults(uploadResults);
      setLoading(false);
      setIsDataUnsaved(false);
    };

    if (!hasUploaded.current) {
      uploadFiles().catch(console.error);
      hasUploaded.current = true;
    }
  }, []);

  return (
    <>
      {loading ? (
        <Box sx={{display: 'flex', flex: 1, width: '100%', alignItems: 'center', mt: 4}}>
          <Stack direction={"column"}>
            <Typography variant="h6" gutterBottom>{`Total Operations: ${totalOperations}`}</Typography>
            <LinearProgressWithLabel variant={"determinate"} value={(completedOperations / totalOperations) * 100}
                                     currentlyrunningmsg={currentlyRunning}/>
          </Stack>
        </Box>
      ) : (
        <Box sx={{display: 'flex', flex: 1, width: '100%', alignItems: 'center', mt: 4}}>
          <Stack direction={"column"} sx={{display: 'inherit'}}>
            <Typography variant="h5" gutterBottom>Upload Complete</Typography>
            {results.map((result) => (
              <Typography key={result}>{result}</Typography>
            ))}
            <Typography>{uploadCompleteMessage}</Typography>
            {/* Display allRowToCMID data */}
            {allRowToCMID.map((row, index) => (
              <Box key={index} sx={{ mt: 2, p: 2, border: '1px solid grey' }}>
                <Typography>Core Measurement ID: {row.coreMeasurementID}</Typography>
                <Typography>File Name: {row.fileName}</Typography>
                <Typography>Plot Name: {row.plotName}</Typography>
                <Typography>Quadrat Name: {row.quadratName}</Typography>
                <Typography>Plot Census Number: {row.plotCensusNumber}</Typography>
                <Typography>Census Start: {row.censusStart}</Typography>
                <Typography>Census End: {row.censusEnd}</Typography>
                <Typography>Personnel Name: {row.personnelName}</Typography>
              </Box>
            ))}
            {/* End of allRowToCMID data display */}
            {(uploadForm === "fixeddata_census" ||
              uploadForm === "ctfsweb_new_plants_form" ||
              uploadForm === "ctfsweb_old_tree_form" ||
              uploadForm === "ctfsweb_multiple_stems_form" ||
              uploadForm === "ctfsweb_big_trees_form") ? (
              <Box>
                <Typography>Your upload included measurements, which must be validated before proceeding</Typography>
                <Button onClick={() => setReviewState(ReviewStates.VALIDATE)} sx={{width: 'fit-content'}}>
                  Continue to Validation
                </Button>
              </Box>
            ) : (
              <Button onClick={handleReturnToStart} sx={{width: 'fit-content'}}>
                Return to Upload Start
              </Button>
            )}
          </Stack>
        </Box>
      )}
    </>
  );
};

export default UploadFire;
