"use client";
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Box, Button, Typography} from '@mui/material';
import {FileCollectionRowSet, FileRow, formatDate, ReviewStates, UploadFireProps} from '@/config/macros';
import {Stack} from "@mui/joy";
import {DetailedCMIDRow} from "@/components/uploadsystem/uploadparent";
import {LinearProgressWithLabel} from "@/components/client/clientmacros";
import CircularProgress from "@mui/joy/CircularProgress";

interface IDToRow {
  coreMeasurementID: number;
  fileRow: FileRow;
}

const UploadFireSQL: React.FC<UploadFireProps> =
  ({
     personnelRecording, acceptedFiles, unitOfMeasurement, parsedData,
     uploadForm, setIsDataUnsaved, currentPlot, currentCensus,
     uploadCompleteMessage, setUploadCompleteMessage,
     setUploadError, setErrorComponent,
     setReviewState, setAllRowToCMID,
   }) => {
    const [loading, setLoading] = useState<boolean>(true);
    const [results, setResults] = useState<string[]>([]);
    const [totalOperations, setTotalOperations] = useState(0);
    const [completedOperations, setCompletedOperations] = useState<number>(0);
    const [currentlyRunning, setCurrentlyRunning] = useState("");
    const hasUploaded = useRef(false);
    // Add new state for countdown timer
    const [countdown, setCountdown] = useState(5);
    const [startCountdown, setStartCountdown] = useState(false);

    const uploadToSql = useCallback(async (fileData: FileCollectionRowSet, fileName: string) => {
      try {
        setCurrentlyRunning(`File ${fileName} uploading to SQL...`);
        const response = await fetch(
          `/api/sqlload?formType=${uploadForm}&fileName=${fileName}&plot=${currentPlot?.id.toString().trim()}&census=${currentCensus?.censusID ? currentCensus.censusID.toString().trim() : 0}&${unitOfMeasurement !== '' ? `&uom=${unitOfMeasurement.trim()}&` : ''}user=${personnelRecording}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(fileData[fileName])
          });
        setCompletedOperations((prevCompleted) => prevCompleted + 1);
        const result = await response.json();
        if (result.idToRows) {
          if (uploadForm === 'fixeddata_census') {
            // Fetch additional details for each coreMeasurementID
            Promise.all(result.idToRows.map(({coreMeasurementID}: IDToRow) =>
              fetch(`/api/details/cmid?cmid=${coreMeasurementID}`)
                .then(response => response.json())
            )).then(details => {
              // Combine details with idToRows data
              const newRowToCMID: DetailedCMIDRow[] = result.idToRows.map(({
                                                                             coreMeasurementID,
                                                                             fileRow
                                                                           }: IDToRow, index: number) => {
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
          } else {
            // Handle other form types without additional details
            const newRowToCMID: DetailedCMIDRow[] = result.idToRows.map(({
                                                                           coreMeasurementID,
                                                                           fileRow
                                                                         }: IDToRow) => ({
              coreMeasurementID,
              fileName,
              row: fileRow
            }));
            setAllRowToCMID(prevState => [...prevState, ...newRowToCMID]);
          }
        }
        return response.ok ? 'SQL load successful' : 'SQL load failed';
      } catch (error) {
        setUploadError(error);
        setErrorComponent('UploadFire');
        setReviewState(ReviewStates.ERRORS);
      }
    }, [uploadForm, currentPlot?.id, currentCensus?.censusID, personnelRecording, setAllRowToCMID, setUploadError, setErrorComponent, setReviewState]);

    useEffect(() => {
      switch (uploadForm) {
        case "fixeddata_codes":
        case "fixeddata_role":
        case "fixeddata_personnel":
        case "fixeddata_species":
        case "fixeddata_quadrat":
          setUploadCompleteMessage("Upload complete! Moving to Azure upload stage...");
          break;
        case "fixeddata_census":
          setUploadCompleteMessage("Upload complete!\nYour upload included measurements, which must be validated before proceeding...");
          break;
        default:
          setUploadCompleteMessage("");
          break;
      }
      const calculateTotalOperations = () => {
        let totalOps = 0;

        for (const _file of acceptedFiles) {
          // Increment totalOps for each file and each operation (SQL and storage)
          totalOps += 1;
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
          uploadResults.push(`File: ${file.name}, SQL: ${sqlResult}`);
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

    // Effect for handling countdown and state transition
    useEffect(() => {
      let timer: number; // Declare timer as a number

      if (startCountdown && countdown > 0) {
        timer = window.setTimeout(() => setCountdown(countdown - 1), 1000) as unknown as number;
        // Use 'window.setTimeout' and type assertion to treat the return as a number
      } else if (countdown === 0) {
        if (uploadForm === "fixeddata_census") {
          setReviewState(ReviewStates.VALIDATE);
        } else {
          setReviewState(ReviewStates.UPLOAD_AZURE);
        }
      }

      return () => clearTimeout(timer); // Clear timeout using the timer variable
    }, [startCountdown, countdown, uploadForm, setReviewState]);

    useEffect(() => {
      if (!loading && completedOperations === totalOperations) {
        setStartCountdown(true); // Start countdown after upload is complete
      }
    }, [loading, completedOperations, totalOperations]);

    return (
      <>
        {loading ? (
          <Box sx={{display: 'flex', flex: 1, width: '100%', alignItems: 'center', mt: 4}}>
            <Stack direction={"column"}>
              <Typography variant="h6" gutterBottom>{`Total Operations: ${totalOperations}`}</Typography>
              <LinearProgressWithLabel variant={"determinate"}
                                       value={(completedOperations / totalOperations) * 100}
                                       currentlyrunningmsg={currentlyRunning}/>
            </Stack>
          </Box>
        ) : (
          <Box sx={{display: 'flex', flex: 1, width: '100%', alignItems: 'center', mt: 4}}>
            <Stack direction={"column"} sx={{display: 'inherit'}}>
              <Typography variant="h5" gutterBottom>Upload Complete</Typography>
              {/* Circular Progress and countdown display */}
              {startCountdown && (
                <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column'}}>
                  <CircularProgress/>
                  <Typography>{countdown} seconds remaining</Typography>
                  <Typography>{uploadCompleteMessage}</Typography>
                </Box>
              )}
            </Stack>
          </Box>
        )}
      </>
    );
  };

export default UploadFireSQL;
