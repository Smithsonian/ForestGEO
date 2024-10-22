'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { ReviewStates, UploadFireProps } from '@/config/macros/uploadsystemmacros';
import { FileCollectionRowSet, FileRow, FormType } from '@/config/macros/formdetails';
import { Stack } from '@mui/joy';
import { LinearProgressWithLabel } from '@/components/client/clientmacros';
import { useOrgCensusContext, usePlotContext, useQuadratContext } from '@/app/contexts/userselectionprovider';
import { useSession } from 'next-auth/react';

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
  setAllRowToCMID
}) => {
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const currentQuadrat = useQuadratContext();
  const [loading, setLoading] = useState<boolean>(true);
  const [results, setResults] = useState<string[]>([]);
  const [totalOperations, setTotalOperations] = useState(0);
  const [completedOperations, setCompletedOperations] = useState<number>(0);
  const [currentlyRunning, setCurrentlyRunning] = useState<string>('');
  const hasUploaded = useRef(false);
  const { data: session } = useSession();

  const uploadToSql = useCallback(
    async (fileData: FileCollectionRowSet, fileName: string) => {
      try {
        const userIDResponse = await fetch(`/api/catalog/${session?.user.name?.split(' ')[0]}/${session?.user.name?.split(' ')[1]}`, { method: 'GET' });
        const userID = await userIDResponse.json();
        setCurrentlyRunning(`Uploading file "${fileName}" to SQL...`);
        const response = await fetch(
          `/api/sqlload?schema=${schema}&formType=${uploadForm}&fileName=${fileName}&plot=${currentPlot?.plotID?.toString().trim()}&census=${currentCensus?.dateRanges[0].censusID.toString().trim()}&quadrat=${currentQuadrat?.quadratID?.toString().trim()}&user=${userID}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fileData[fileName])
          }
        );
        if (!response.ok) throw new Error('SQLLOAD ERROR: ' + response.statusText);

        setCompletedOperations(prevCompleted => prevCompleted + 1);

        // const result = await response.json();
        //
        // if (result.idToRows) {
        //   setCurrentlyRunning(`Fetching CMID details for file "${fileName}"...`);
        //   if (uploadForm === 'measurements') {
        //     Promise.all(
        //       result.idToRows.map(({ coreMeasurementID }: IDToRow) =>
        //         fetch(`/api/details/cmid?schema=${schema}&cmid=${coreMeasurementID}`).then(response => response.json())
        //       )
        //     )
        //       .then(details => {
        //         const newRowToCMID: DetailedCMIDRow[] = result.idToRows.map(({ coreMeasurementID, fileRow }: IDToRow, index: number) => {
        //           const detailArray = details[index];
        //           if (Array.isArray(detailArray) && detailArray.length > 0) {
        //             const detail = detailArray[0];
        //             if ('plotName' in detail && 'quadratName' in detail && 'plotCensusNumber' in detail && 'speciesName' in detail) {
        //               return {
        //                 coreMeasurementID,
        //                 fileName,
        //                 row: fileRow,
        //                 plotName: detail.plotName,
        //                 quadratName: detail.quadratName,
        //                 plotCensusNumber: detail.plotCensusNumber,
        //                 speciesName: detail.speciesName
        //               };
        //             } else {
        //               throw new Error('Detail object missing required properties');
        //             }
        //           } else {
        //             throw new Error('Invalid detail array structure');
        //           }
        //         });
        //         setAllRowToCMID(prevState => [...prevState, ...newRowToCMID]);
        //       })
        //       .catch(error => {
        //         console.error('Error fetching CMID details:', error);
        //         setUploadError(error);
        //         setReviewState(ReviewStates.ERRORS);
        //       });
        //   } else {
        //     const newRowToCMID: DetailedCMIDRow[] = result.idToRows.map(({ coreMeasurementID, fileRow }: IDToRow) => ({
        //       coreMeasurementID,
        //       fileName,
        //       row: fileRow
        //     }));
        //     setAllRowToCMID(prevState => [...prevState, ...newRowToCMID]);
        //   }
        // }

        return response.ok ? 'SQL load successful' : 'SQL load failed';
      } catch (error) {
        setUploadError(error);
        setReviewState(ReviewStates.ERRORS);
      }
    },
    [
      uploadForm,
      currentPlot?.plotID,
      currentCensus?.dateRanges[0].censusID,
      personnelRecording,
      setAllRowToCMID,
      setUploadError,
      setReviewState,
      schema,
      currentQuadrat?.quadratID
    ]
  );

  useEffect(() => {
    const calculateTotalOperations = () => {
      const totalOps = acceptedFiles.length;

      setTotalOperations(totalOps);
    };

    const uploadFiles = async () => {
      const uploadResults: string[] = [];

      calculateTotalOperations();

      for (const file of acceptedFiles) {
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
    if (!loading && completedOperations === totalOperations) {
      if (uploadForm === FormType.measurements)
        setReviewState(ReviewStates.VALIDATE); // because 2x entry is site-dependent, default behavior should be to trigger validations
      else setReviewState(ReviewStates.UPLOAD_AZURE);
    }
  }, [loading, completedOperations, totalOperations]);

  return (
    <>
      {loading ? (
        <Box
          sx={{
            display: 'flex',
            flex: 1,
            width: '100%',
            alignItems: 'center',
            mt: 4
          }}
        >
          <Stack direction={'column'}>
            <Typography variant="h6" gutterBottom>{`Total Operations: ${totalOperations}`}</Typography>
            <LinearProgressWithLabel variant={'determinate'} value={(completedOperations / totalOperations) * 100} currentlyrunningmsg={currentlyRunning} />
            <Typography variant="body2" sx={{ mt: 2 }}>{`Completed: ${completedOperations} of ${totalOperations} operations`}</Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>
              {currentlyRunning}
            </Typography>
          </Stack>
        </Box>
      ) : (
        <Box
          sx={{
            display: 'flex',
            flex: 1,
            width: '100%',
            alignItems: 'center',
            mt: 4
          }}
        >
          <Stack direction={'column'} sx={{ display: 'inherit' }}>
            <Typography variant="h5" gutterBottom>
              Upload Complete
            </Typography>
          </Stack>
        </Box>
      )}
    </>
  );
};

export default UploadFireSQL;
