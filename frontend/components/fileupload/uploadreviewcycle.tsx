"use client";
import React, {useCallback, useEffect, useState} from "react";
import {
  AllRowsData,
  ErrorRowsData,
  FileErrors,
  HTTPResponses,
  ReviewStates,
  TableHeadersByFormType
} from "@/config/macros";
import {FileWithPath} from "react-dropzone";
import {
  DataStructure,
  DisplayErrorGrid,
  DisplayErrorTable,
  DisplayParsedData
} from "@/components/fileupload/validationtable";
import {parse, ParseResult} from "papaparse";
import {useCensusContext, usePlotContext} from "@/app/contexts/userselectionprovider";
import {useSession} from "next-auth/react";
import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Grid,
  LinearProgress,
  Pagination
} from "@mui/material";
import {LoadingButton} from '@mui/lab';
import {styled} from '@mui/system';
import Divider from "@mui/joy/Divider";
import {DropzoneLogic} from "@/components/fileupload/dropzone";
import {FileDisplay} from "@/components/fileupload/filelist";
import {Box, Checkbox, Stack, Tab, TabList, TabPanel, Tabs, Typography} from "@mui/joy";
import SelectFormType from "@/components/fileupload/groupedformselection";
import ViewUploadedFiles from "@/components/fileupload/viewuploadedfiles";

export function UploadAndReviewProcess() {
  let tempData: { fileName: string; data: DataStructure[] }[] = [];
  const initState: { fileName: string; data: DataStructure[] }[] = [];
  // select schema table that file should be uploaded to --> state
  const [uploadForm, setUploadForm] = useState("");
  // in progress state --> data is being parsed
  const [parsing, setParsing] = useState(false);
  // in progress state --> async upload function has completed
  const [uploaded, setUploaded] = useState(false);
  // core enum to handle state progression
  const [reviewState, setReviewState] = useState<ReviewStates>(ReviewStates.PARSE);
  // dropped file storage
  const [acceptedFiles, setAcceptedFiles] = useState<FileWithPath[]>([]);
  // validated error storage
  const [errorsData, setErrorsData] = useState<FileErrors>({});
  const [allRows, setAllRows] = useState<AllRowsData>({});
  // pagination counter to manage validation table view/allow scroll through files in REVIEW
  const [dataViewActive, setDataViewActive] = useState(1);
  // for REVIEW --> storage of parsed data for display
  const [parsedData, setParsedData] = useState(initState);
  // Confirmation menu states:
  const [confirmationDialogOpen, setConfirmationDialogOpen] = React.useState(false);
  const [currentFileHeaders, setCurrentFileHeaders] = useState<string[]>([]);
  const [receivedHeaders, setReceivedHeaders] = useState<string[]>([]);
  const [expectedHeaders, setExpectedHeaders] = useState<string[]>([]);
  const [errorRowsData, setErrorRowsData] = useState<ErrorRowsData>({});
  const [uploadCompleteMessage, setUploadCompleteMessage] = useState("");
  const [allFileHeaders, setAllFileHeaders] = useState<{ [key: string]: string[] }>({});
  // etc.
  let currentPlot = usePlotContext();
  let currentCensus = useCensusContext();
  const {data: session} = useSession();

  async function handleReturnToStart() {
    setDataViewActive(1);
    setUploaded(false);
    setAcceptedFiles([]);
    setParsedData(initState);
    tempData = [];
    setErrorsData({});
    setReviewState(ReviewStates.PARSE);
    setUploadForm('');
  }

  function areHeadersValid(actualHeaders: string[]): boolean {
    const expectedHeadersLower = expectedHeaders.map(header => header.toLowerCase());
    const actualHeadersLower = actualHeaders.map(header => header.toLowerCase());

    const allExpectedHeadersPresent = expectedHeadersLower.every(expectedHeader =>
      actualHeadersLower.includes(expectedHeader));

    const noAdditionalHeaders = actualHeadersLower.every(actualHeader =>
      expectedHeadersLower.includes(actualHeader));

    return allExpectedHeadersPresent && noAdditionalHeaders;
  }

  async function handleInitialSubmit() {
    setParsing(true);
    console.log("in initial submit");
    let collectFileHeaders = {...allFileHeaders}; // Create a copy of the current state

    acceptedFiles.forEach((file: FileWithPath) => {
      parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: function (results: ParseResult<any>) {
          try {
            collectFileHeaders[file.name] = results.meta.fields!;
            console.log("expected: " + expectedHeaders.toString());
            console.log("received: " + results.meta.fields!.toString());

            tempData.push({fileName: file.name, data: results.data});
            console.log(tempData.toString());
          } catch (e) {
            console.error(e);
            setReviewState(ReviewStates.FILE_MISMATCH_ERROR);
          } finally {
            setParsing(false);
            setAllFileHeaders(collectFileHeaders); // Update the state with all headers
          }
        },
      });
    });
    console.log(collectFileHeaders);
    setParsedData(tempData);
    setReviewState(ReviewStates.REVIEW);
  }

  async function handleMismatchToStart() {
    setUploadForm('');
    setReviewState(ReviewStates.PARSE);
  }

  // handlers
  const handleUpload = useCallback(async () => {
    try {
      setConfirmationDialogOpen(false);
      if (acceptedFiles.length === 0) {
        console.log("No files selected for upload.");
        throw new Error("No files selected for upload.");
      }
      const fileToFormData = new FormData();
      acceptedFiles.forEach((file, index) => {
        fileToFormData.append(`file_${index}`, file);
      });
      const response = await fetch(`/api/upload?plot=${currentPlot?.key.trim()}&census=${currentCensus?.plotCensusNumber}&user=${session?.user?.name}&formType=${uploadForm.trim()}`, {
        method: 'POST',
        body: fileToFormData,
      });
      if (!response.ok && response.status !== HTTPResponses.ERRORS_IN_FILE) {
        console.log("Upload failed with status: " + response.status);
        throw new Error("Upload failed with status: " + response.status);
      }
      const data = await response.json();
      setErrorsData(data.errors as FileErrors);
      setErrorRowsData(data.errorRows as ErrorRowsData);
      setAllRows(data.allRows as AllRowsData);
      setUploaded(true);
    } catch (error: any) {
      console.error("Upload Error: ", error.message);
      // Optionally, update the UI to reflect the error
    }
  }, [acceptedFiles, currentPlot, session]);

  useEffect(() => {
    if (acceptedFiles.length > 0 && dataViewActive <= acceptedFiles.length) {
      const currentFile = acceptedFiles[dataViewActive - 1];
      if (currentFile && allFileHeaders[currentFile.name]) {
        setCurrentFileHeaders(allFileHeaders[currentFile.name]);
      } else {
        setCurrentFileHeaders([]);
      }
    }
    if (acceptedFiles.length === 0 && reviewState === ReviewStates.REVIEW) setReviewState(ReviewStates.PARSE); // if the user removes all files, move back to file drop phase
    if (reviewState == ReviewStates.UPLOAD) {
      if (!uploaded) {
        handleUpload().then();
      } else if (errorsData && Object.keys(errorsData).length !== 0) {
        setReviewState(ReviewStates.ERRORS);
      } else {
        setReviewState(ReviewStates.UPLOADED);
      }
    }
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
  }, [errorsData, handleUpload, reviewState, uploaded, dataViewActive, acceptedFiles, setCurrentFileHeaders, allFileHeaders, setUploadCompleteMessage, uploadCompleteMessage]);


  async function handleApproval() {
    setConfirmationDialogOpen(true);
  }

  async function handleCancel() {
    setConfirmationDialogOpen(false);
  }

  async function handleConfirm() {
    setConfirmationDialogOpen(false);
    setReviewState(ReviewStates.UPLOAD);
  }

  const handleChange = (_event: React.ChangeEvent<unknown>, value: number) => {
    setDataViewActive(value);
  };

  const handleRemoveCurrentFile = () => {
    setAcceptedFiles(prevFiles => {
      // Remove the file at the current index
      const updatedFiles = prevFiles.filter((_, index) => index !== (dataViewActive - 1));
      // Adjust the current page if necessary
      if (dataViewActive > updatedFiles.length) {
        setDataViewActive(updatedFiles.length);
      }
      return updatedFiles;
    });
  };

  const ParseState = () => (
    <Box sx={{display: 'flex', flex: 1, flexDirection: 'column'}}>
      {!TableHeadersByFormType.hasOwnProperty(uploadForm) ? <Stack direction={"column"} sx={{width: 'fit-content'}}>
        <Typography sx={{mb: 2}}>
          Your file will need the correct headers in order to be uploaded to your intended table
          destination.<br/> Please review the table header requirements before continuing:
        </Typography>
        <Box sx={{display: 'flex', width: 'fit-content', justifyContent: 'center', mb: 1}}>
          <SelectFormType
            externalState={uploadForm}
            updateExternalState={setUploadForm}
            updateExternalHeaders={setExpectedHeaders}
          />
        </Box>
      </Stack> : <Stack direction={"column"} sx={{width: 'fit-content'}}>
        <Button onClick={() => setUploadForm('')} sx={{width: 'fit-content'}}>
          Return to Table Select
        </Button>
        <Typography sx={{mb: 2}}>
          You have selected {uploadForm}. Please ensure that your file has the following headers before continuing:
        </Typography>
        <Typography>
          {uploadForm !== '' && TableHeadersByFormType[uploadForm]?.map(obj => obj.label).join(', ')}
        </Typography>
      </Stack>}
      {TableHeadersByFormType.hasOwnProperty(uploadForm) && <Grid container spacing={2}>
        <Grid item xs={5}>
          <Box sx={{display: 'flex', flexDirection: 'column', mb: 10, mr: 10}}>
            <DropzoneLogic onChange={(acceptedFiles: FileWithPath[]) => {
              // rejectFile handling needs to go somewhere
              setAcceptedFiles((files) => acceptedFiles.concat(files));
            }}/>
          </Box>
        </Grid>

        <Grid item xs={2}>
          <Divider orientation="vertical" sx={{mx: 4}}/>
        </Grid>

        <Grid item xs={5}>
          <Stack direction={"column"} sx={{display: 'flex', flexDirection: 'column', mb: 10}}>
            <Box sx={{display: 'flex', flex: 1, justifyContent: 'center'}}>
              <FileDisplay acceptedFiles={acceptedFiles}/>
            </Box>
            <LoadingButton disabled={acceptedFiles.length <= 0} loading={parsing} onClick={handleInitialSubmit}>
              Review Files
            </LoadingButton>
          </Stack>
        </Grid>
      </Grid>}
    </Box>
  )
  const ReviewState = () => (
    <Grid container spacing={2}>
      <Grid xs={5}>
        <Box sx={{display: 'flex', flexDirection: 'column', mb: 10, mr: 10}}>
          {acceptedFiles.length > 0 &&
            acceptedFiles[dataViewActive - 1] &&
            parsedData &&
            DisplayParsedData(parsedData.find((file) => file.fileName == acceptedFiles[dataViewActive - 1].name) ?? {
              fileName: '',
              data: [],
            }, uploadForm)}
          <Pagination count={acceptedFiles.length} page={dataViewActive} onChange={handleChange}/>
        </Box>
      </Grid>

      <Grid xs={2}>
        <Divider orientation="vertical" sx={{my: 4}}/>
      </Grid>

      <Grid xs={5}>
        <Box sx={{display: 'flex', flexDirection: 'column', mb: 10}}>
          <Button variant="contained" color="primary" onClick={handleRemoveCurrentFile} sx={{width: 'fit-content'}}>
            Remove Current File
          </Button>
          <Divider orientation={"horizontal"}/>
          {currentFileHeaders.length > 0 ? (
            expectedHeaders.map((header) => (
              <Checkbox
                size={"lg"}
                key={header}
                disabled
                checked={currentFileHeaders.map(item => item.trim().toLowerCase()).includes(header.trim().toLowerCase())}
                label={header}
                color={"success"}
              />
            ))
          ) : (
            <Typography>No file selected or file has no headers.</Typography>
          )}
          <Button
            variant={"contained"}
            disabled={!areHeadersValid(currentFileHeaders)}
            onClick={handleApproval}
            className={"flex w-1/4 h-1/6 justify-center"}
            sx={{width: 'fit-content'}}
          >
            Confirm Changes
          </Button>
        </Box>
      </Grid>
      <Dialog
        open={confirmationDialogOpen}
        onClose={handleCancel}
        aria-labelledby="alert-dialog-title"
        aria-describedby="alert-dialog-description"
      >
        <DialogTitle id="alert-dialog-title">
          {"Do your files look correct?"}
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="alert-dialog-description">
            Please press Confirm to upload your files to storage.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Stack direction={"row"}>
            <Button onClick={handleCancel}>Cancel</Button>
            <Button onClick={handleConfirm} autoFocus>
              Confirm
            </Button>
          </Stack>
        </DialogActions>
      </Dialog>
    </Grid>
  )

  const FileMismatchErrorState = () => (
    <Grid container spacing={2}>
      <Grid xs={5}>
        <Box sx={{display: 'flex', flexDirection: 'column', mb: 10, mr: 10}}>
          <Typography>
            You attempted to upload a file with the following headers:
          </Typography> <br/>
          <Typography>{receivedHeaders.join(', ')}</Typography>
        </Box>
        <Box sx={{display: 'flex', flex: 1, justifyContent: 'center'}}>
          <Typography>However, you selected form {uploadForm}</Typography> <br/>
          <Typography>Which has headers: {expectedHeaders.join(', ')}</Typography>
        </Box>
      </Grid>

      <Grid xs={2}>
        <Divider orientation="vertical" sx={{my: 4}}/>
      </Grid>

      <Grid xs={5}>
        <Box sx={{display: 'flex', flexDirection: 'column', mb: 10}}>
          <LoadingButton disabled={acceptedFiles.length <= 0} loading={parsing} onClick={handleMismatchToStart}>
            Return to Start
          </LoadingButton>
        </Box>
      </Grid>
    </Grid>
  )

  const UploadState = () => (
    <Box>
      <LinearProgress
        color={"primary"}
        aria-label="Uploading..."
        className="w-auto"
      />
    </Box>
  )
  const ErrorState = () => {
    return (
      <Grid container spacing={2}>
        <Grid xs={5}>
          <Box sx={{display: 'flex', flexDirection: 'column', mb: 10, mr: 10}}>
            {Object.keys(errorRowsData).map((fileName: string) => {
              const fileDataStructure = errorRowsData[fileName].map((rowData) => {
                // Convert each value in RowDataStructure to a string for DataStructure
                const convertedRow: DataStructure = {};
                for (const key in rowData) {
                  convertedRow[key] = String(rowData[key]);
                }
                return convertedRow;
              });

              return (
                <DisplayErrorGrid
                  key={fileName}
                  fileName={fileName}
                  fileData={{fileName, data: fileDataStructure}}
                  errorMessage={errorsData[fileName] as unknown as FileErrors} // Cast the type if structures are compatible
                  formType={uploadForm}
                />
              );
            })}
            <Pagination count={acceptedFiles.length} page={dataViewActive} onChange={handleChange}/>
          </Box>
        </Grid>

        <Grid xs={2}>
          <Divider orientation="vertical" sx={{my: 4}}/>
        </Grid>

        <Grid xs={5}>
          <Box sx={{display: 'flex', flexDirection: 'column', mb: 10}}>
            <Card>
              <CardContent>
                <Typography sx={{fontSize: 16, color: 'red', fontWeight: 'bold'}}>WARNING!</Typography>
                <Typography sx={{fontSize: 14, color: 'red'}}>Errors were found in your file (highlighted in
                  red).</Typography>
                <Typography sx={{fontSize: 14, color: 'red'}}>All rows not highlighted red were successfully
                  uploaded to storage.</Typography>
                <Typography sx={{fontSize: 14, color: 'red'}}>The submitted file was saved to storage and has been
                  marked as containing errors.</Typography>
              </CardContent>
            </Card>
          </Box>
        </Grid>
      </Grid>
    );
  }

  const ErrorCorrectionState = () => {
    return (
      <Grid container spacing={2}>
        <Grid xs={5}>
          <Box sx={{display: 'flex', flexDirection: 'column', mb: 10, mr: 10}}>
            {Object.keys(errorRowsData).map((fileName: string) => {
              const fileDataStructure = errorRowsData[fileName].map((rowData) => {
                // Convert each value in RowDataStructure to a string for DataStructure
                const convertedRow: DataStructure = {};
                for (const key in rowData) {
                  convertedRow[key] = String(rowData[key]);
                }
                return convertedRow;
              });

              return (
                <DisplayErrorTable
                  key={fileName}
                  fileName={fileName}
                  fileData={{fileName, data: fileDataStructure}}
                  errorMessage={errorsData[fileName] as unknown as FileErrors} // Cast the type if structures are compatible
                  formType={uploadForm}
                />
              );
            })}
            <Pagination count={acceptedFiles.length} page={dataViewActive} onChange={handleChange}/>
          </Box>
        </Grid>

        <Grid xs={2}>
          <Divider orientation="vertical" sx={{my: 4}}/>
        </Grid>

        <Grid xs={5}>
          <Box sx={{display: 'flex', flexDirection: 'column', mb: 10}}>
            <Card>
              <CardContent>
                <Typography sx={{fontSize: 16, color: 'red', fontWeight: 'bold'}}>WARNING!</Typography>
                <Typography sx={{fontSize: 14, color: 'red'}}>Errors were found in your file (highlighted in
                  red).</Typography>
                <Typography sx={{fontSize: 14, color: 'red'}}>All rows not highlighted red were successfully
                  uploaded to storage.</Typography>
                <Typography sx={{fontSize: 14, color: 'red'}}>The submitted file was saved to storage and has been
                  marked as containing errors.</Typography>
              </CardContent>
            </Card>
          </Box>
        </Grid>
      </Grid>
    );
  }
  const UploadedState = () => (
    <Grid container spacing={2}>
      <Grid xs={5}>
        <Box sx={{display: 'flex', flexDirection: 'column', mb: 10, mr: 10}}>
          {DisplayParsedData(parsedData.find((file) => file.fileName == acceptedFiles[dataViewActive - 1].name) ?? {
            fileName: '',
            data: [],
          }, uploadForm)}
          <Pagination count={acceptedFiles.length} page={dataViewActive} onChange={handleChange}/>
        </Box>
      </Grid>

      <Grid xs={2}>
        <Divider orientation="vertical" sx={{my: 4}}/>
      </Grid>

      <Grid xs={5}>
        <Box className={"flex justify-center"} sx={{display: 'flex', flexDirection: 'column'}}>
          Data was successfully uploaded! <br/>
          <Typography>{uploadCompleteMessage}</Typography>
          <Button onClick={handleReturnToStart} sx={{width: 'fit-content'}}>
            Return to Upload Start
          </Button>
        </Box>
      </Grid>
    </Grid>
  )

  const renderStateContent = () => {
    switch (reviewState) {
      case ReviewStates.PARSE:
        return <ParseState/>;
      case ReviewStates.REVIEW:
        return <ReviewState/>;
      case ReviewStates.UPLOAD:
        return <UploadState/>;
      case ReviewStates.ERRORS:
        return <ErrorState/>;
      case ReviewStates.UPLOADED:
        return <UploadedState/>;
      case ReviewStates.FILE_MISMATCH_ERROR:
        return <FileMismatchErrorState/>;
      default:
        return <div>Invalid State</div>;
    }
  }
  return (
    <Box sx={{display: 'flex', width: '100%', flexDirection: 'column', marginBottom: 5}}>
      <Typography level={"title-lg"} color={"primary"}>
        Drag and drop files into the box to upload them to storage
      </Typography>
      <Box sx={{mt: 5, mr: 5, width: '95%'}}>
        <Tabs sx={{display: 'flex', flex: 1}} aria-label={"File Hub Options"} size={"lg"} className={""}>
          <TabList sticky={"top"}>
            <Tab>Browse Uploaded Files</Tab>
            <Tab>Upload New Files</Tab>
          </TabList>
          <TabPanel value={0}>
            <ViewUploadedFiles currentPlot={currentPlot} currentCensus={currentCensus}/>
          </TabPanel>
          <TabPanel value={1}>
            {currentPlot ? renderStateContent() : <Typography>You must select a plot to continue!</Typography>}
          </TabPanel>
        </Tabs>
      </Box>
    </Box>
  );
}

const grey = {
  50: '#f6f8fa',
  100: '#eaeef2',
  200: '#d0d7de',
  300: '#afb8c1',
  400: '#8c959f',
  500: '#6e7781',
  600: '#57606a',
  700: '#424a53',
  800: '#32383f',
  900: '#24292f',
};
styled('ul')(
  ({theme}) => `
  font-family: IBM Plex Sans, sans-serif;
  font-size: 0.875rem;
  box-sizing: border-box;
  padding: 6px;
  margin: 12px 0;
  min-width: 200px;
  border-radius: 12px;
  overflow: auto;
  outline: 0px;
  background: ${theme.palette.mode === 'dark' ? grey[900] : '#fff'};
  border: 1px solid ${theme.palette.mode === 'dark' ? grey[700] : grey[200]};
  color: ${theme.palette.mode === 'dark' ? grey[300] : grey[900]};
  box-shadow: 0px 2px 16px ${theme.palette.mode === 'dark' ? grey[900] : grey[200]};
  z-index: 1;
  `,
);

