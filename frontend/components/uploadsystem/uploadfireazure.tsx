"use client";

import React, {useCallback, useEffect, useRef, useState} from "react";
import {ReviewStates, UploadFireAzureProps} from "@/config/macros";
import {FileWithPath} from "react-dropzone";
import {Box, Typography} from "@mui/material";
import {Button, Stack} from "@mui/joy";
import {LinearProgressWithLabel} from "@/components/client/clientmacros";
import CircularProgress from "@mui/joy/CircularProgress";

const UploadFireAzure: React.FC<UploadFireAzureProps> = ({
                                                           acceptedFiles, uploadForm, setIsDataUnsaved,
                                                           currentPlot, currentCensus, uploadCompleteMessage,
                                                           setUploadCompleteMessage, handleReturnToStart,
                                                           user, setUploadError,
                                                           setErrorComponent,
                                                           setReviewState,
                                                           allRowToCMID,
                                                           cmErrors,
                                                           setCMErrors
                                                         }) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [results, setResults] = useState<string[]>([]);
  const [totalOperations, setTotalOperations] = useState(0);
  const [completedOperations, setCompletedOperations] = useState<number>(0);
  const [currentlyRunning, setCurrentlyRunning] = useState("");
  const hasUploaded = useRef(false);
  const [timer, setTimer] = useState<number>(5); // State for the countdown timer
  const [showTimer, setShowTimer] = useState<boolean>(false); // State to control whether the timer is shown

  const handleCompleteUpload = () => {
    setReviewState(ReviewStates.COMPLETE); // Transition to the COMPLETE review state
  };

  const mapCMErrorsToFileRowErrors = (fileName: string) => {
    return cmErrors
      .filter(error => allRowToCMID.some(row => row.fileName === fileName && row.coreMeasurementID === error.CoreMeasurementID))
      .flatMap(error => {
        const relatedRow = allRowToCMID.find(row => row.coreMeasurementID === error.CoreMeasurementID);
        return error.ValidationErrorIDs.map(validationErrorID => ({
          stemtag: relatedRow?.row.stemtag,
          tag: relatedRow?.row.tag,
          validationErrorID: validationErrorID
        }));
      });
  };

  const uploadToStorage = useCallback(async (file: FileWithPath) => {
    try {
      setCurrentlyRunning(`File ${file.name} uploading to Azure Storage...`);
      const fileRowErrors = mapCMErrorsToFileRowErrors(file.name);

      const formData = new FormData();
      formData.append(file.name, file);
      formData.append('fileRowErrors', JSON.stringify(fileRowErrors)); // Append validation errors to formData


      const response = await fetch(
        `/api/storageload?fileName=${file.name}&plot=${currentPlot?.key.trim()}&census=${currentCensus?.censusID ? currentCensus.censusID.toString().trim() : 0}&user=${user}&formType=${uploadForm}`, {
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
  }, [currentCensus?.censusID, currentPlot?.key, setErrorComponent, setReviewState, setUploadError, user, cmErrors, allRowToCMID]);

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
        const storageResult = await uploadToStorage(file);
        uploadResults.push(`File: ${file.name}, Storage: ${storageResult}`);
      }

      setResults(uploadResults);
      setLoading(false);
      setIsDataUnsaved(false);
    };

    if (!hasUploaded.current) {
      uploadFiles().catch(console.error);
      hasUploaded.current = true;
    }

    if (!loading && completedOperations === totalOperations) {
      setShowTimer(true); // Show the timer once uploading is completed
    }
  }, []);

  useEffect(() => {
    let timeout: NodeJS.Timeout;
    if (showTimer && timer > 0) {
      // Set a countdown timer
      timeout = setTimeout(() => setTimer(timer - 1), 1000);
    } else if (timer === 0) {
      handleCompleteUpload(); // Transition to COMPLETE when the timer reaches 0
    }
    return () => clearTimeout(timeout); // Cleanup the timeout on component unmount
  }, [timer, showTimer]);


  return <>
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
          {showTimer ? (
            <Box>
              <CircularProgress />
              <Typography>Continuing in {timer} seconds...</Typography>
            </Box>
          ) : (
            <Button onClick={handleCompleteUpload} sx={{width: 'fit-content', mt: 2}}>
              Complete Upload
            </Button>
          )}
        </Stack>
      </Box>
    )}
  </>;
}

export default UploadFireAzure;