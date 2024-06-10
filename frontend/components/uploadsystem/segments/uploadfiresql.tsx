"use client";
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Box, Typography} from '@mui/material';
import {formatDate} from '@/config/macros';
import {ReviewStates} from "@/config/macros/uploadsystemmacros";
import {UploadFireProps} from "@/config/macros/uploadsystemmacros";
import {FileCollectionRowSet, FileRow} from "@/config/macros/formdetails";
import {Stack} from "@mui/joy";
import {DetailedCMIDRow} from "@/components/uploadsystem/uploadparent";
import {LinearProgressWithLabel} from "@/components/client/clientmacros";
import CircularProgress from "@mui/joy/CircularProgress";
import {useOrgCensusContext, usePlotContext, useQuadratContext} from '@/app/contexts/userselectionprovider';

interface IDToRow {
  coreMeasurementID: number;
  fileRow: FileRow;
}

const UploadFireSQL: React.FC<UploadFireProps> = ({
                                                    personnelRecording,
                                                    acceptedFiles,
                                                    parsedData,
                                                    uploadForm,
                                                    setIsDataUnsaved,
                                                    schema,
                                                    uploadCompleteMessage,
                                                    setUploadCompleteMessage,
                                                    setUploadError,
                                                    setReviewState,
                                                    setAllRowToCMID,
                                                  }) => {
  let currentPlot = usePlotContext();
  let currentCensus = useOrgCensusContext();
  let currentQuadrat = useQuadratContext();
  const [loading, setLoading] = useState<boolean>(true);
  const [results, setResults] = useState<string[]>([]);
  const [totalOperations, setTotalOperations] = useState(0);
  const [completedOperations, setCompletedOperations] = useState<number>(0);
  const [currentlyRunning, setCurrentlyRunning] = useState("");
  const hasUploaded = useRef(false);
  const [countdown, setCountdown] = useState(5);
  const [startCountdown, setStartCountdown] = useState(false);

  const uploadToSql = useCallback(async (fileData: FileCollectionRowSet, fileName: string) => {
    try {
      setCurrentlyRunning(`File ${fileName} uploading to SQL...`);
      console.log('rows: ', fileData[fileName]);
      const response = await fetch(
        `/api/sqlload?schema=${schema}&formType=${uploadForm}&fileName=${fileName}&plot=${currentPlot?.plotID?.toString().trim()}&census=${currentCensus?.dateRanges[0].censusID.toString().trim()}&quadrat=${currentQuadrat?.quadratID?.toString().trim()}&user=${personnelRecording}`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(fileData[fileName])
        });
      setCompletedOperations((prevCompleted) => prevCompleted + 1);
      const result = await response.json();
      if (result.idToRows) {
        if (uploadForm === 'measurements') {
          Promise.all(result.idToRows.map(({coreMeasurementID}: IDToRow) =>
            fetch(`/api/details/cmid?schema=${schema}&cmid=${coreMeasurementID}`)
              .then(response => response.json())
          )).then(details => {
            const newRowToCMID: DetailedCMIDRow[] = result.idToRows.map(({
                                                                           coreMeasurementID,
                                                                           fileRow
                                                                         }: IDToRow, index: number) => {
              const detailArray = details[index];
              if (Array.isArray(detailArray) && detailArray.length > 0) {
                const detail = detailArray[0];
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
            setReviewState(ReviewStates.ERRORS);
          });
        } else {
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
      setReviewState(ReviewStates.ERRORS);
    }
  }, [uploadForm, currentPlot?.plotID, currentCensus?.dateRanges[0].censusID, personnelRecording, setAllRowToCMID, setUploadError, setReviewState]);

  useEffect(() => {
    switch (uploadForm) {
      case "attributes":
      case "roles":
      case "personnel":
      case "species":
      case "quadrats":
      case "subquadrats":
        setUploadCompleteMessage("Upload complete! Moving to Azure upload stage...");
        break;
      case "measurements":
        setUploadCompleteMessage("Upload complete!\nYour upload included measurements, which must be validated before proceeding...");
        break;
      default:
        setUploadCompleteMessage("");
        break;
    }

    const calculateTotalOperations = () => {
      let totalOps = 0;

      for (const _file of acceptedFiles) {
        totalOps += 1;
      }

      setTotalOperations(totalOps);
    };

    const uploadFiles = async () => {
      const uploadResults: string[] = [];

      calculateTotalOperations();

      console.log(`uploadfire acceptedfiles length: ${acceptedFiles.length}`);
      console.log('parsedData: ', parsedData);

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
  }, [parsedData, uploadToSql]);

  useEffect(() => {
    let timer: number;

    if (startCountdown && countdown > 0) {
      timer = window.setTimeout(() => setCountdown(countdown - 1), 1000) as unknown as number;
    } else if (countdown === 0) {
      if (uploadForm === "measurements") {
        setReviewState(ReviewStates.VALIDATE);
      } else {
        setReviewState(ReviewStates.UPLOAD_AZURE);
      }
    }

    return () => clearTimeout(timer);
  }, [startCountdown, countdown, uploadForm, setReviewState]);

  useEffect(() => {
    if (!loading && completedOperations === totalOperations) {
      setStartCountdown(true);
    }
  }, [loading, completedOperations, totalOperations]);

  return (
    <>
      {loading ? (
        <Box sx={{display: 'flex', flex: 1, width: '100%', alignItems: 'center', mt: 4}}>
          <Stack direction={"column"}>
            <Typography variant="h6" gutterBottom>{`Total Operations: ${totalOperations}`}</Typography>
            <LinearProgressWithLabel
              variant={"determinate"}
              value={(completedOperations / totalOperations) * 100}
              currentlyrunningmsg={currentlyRunning}
            />
          </Stack>
        </Box>
      ) : (
        <Box sx={{display: 'flex', flex: 1, width: '100%', alignItems: 'center', mt: 4}}>
          <Stack direction={"column"} sx={{display: 'inherit'}}>
            <Typography variant="h5" gutterBottom>Upload Complete</Typography>
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