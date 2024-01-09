"use client";
import React, {useCallback, useEffect, useState} from "react";
import {FileErrors, ReviewStates, TableHeadersByFormType} from "@/config/macros";
import {FileWithPath} from "react-dropzone";
import {DataStructure, DisplayErrorTable, DisplayParsedData} from "@/components/fileupload/validationtable";
import {parse, ParseResult} from "papaparse";
import {usePlotContext} from "@/app/contexts/userselectioncontext";
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
  LinearProgress,
  Pagination,
} from "@mui/material";
import {LoadingButton} from '@mui/lab';
import {styled} from '@mui/system';
import Divider from "@mui/joy/Divider";
import {DropzoneLogic} from "@/components/fileupload/dropzone";
import {FileDisplay} from "@/components/fileupload/filelist";
import {Box, Grid, Tab, TabList, TabPanel, Tabs, Typography} from "@mui/joy";
import SelectFormType from "@/components/fileupload/groupedformselection";
import ViewUploadedCSVFiles from "@/components/fileupload/viewuploadedfiles";

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
  const [reviewState, setReviewState] = useState<ReviewStates>(ReviewStates.TABLE_SELECT);
  // dropped file storage
  const [acceptedFiles, setAcceptedFiles] = useState<FileWithPath[]>([]);
  // validated error storage
  const [errorsData, setErrorsData] = useState<FileErrors>({});
  // pagination counter to manage validation table view/allow scroll through files in REVIEW
  const [dataViewActive, setDataViewActive] = useState(1);
  // for REVIEW --> storage of parsed data for display
  const [parsedData, setParsedData] = useState(initState);
  // Confirmation menu states:
  const [confirmationDialogOpen, setConfirmationDialogOpen] = React.useState(false);
  const [receivedHeaders, setReceivedHeaders] = useState<string[]>([]);
  const [expectedHeaders, setExpectedHeaders] = useState<string[]>([]);
  // etc.
  let currentPlot = usePlotContext();
  const {data: session} = useSession();

  function areHeadersValid(actualHeaders: string[] | undefined): boolean {
    if (!actualHeaders) return false;
    // Check if every expected header is present in actual headers
    return expectedHeaders.every(expectedHeader => actualHeaders.includes(expectedHeader));
  }

  async function handleInitialSubmit() {
    setParsing(true);
    acceptedFiles.forEach((file: FileWithPath) => {
      parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: function (results: ParseResult<any>) {
          try {
            // Check if headers match
            setReceivedHeaders(results.meta.fields!); // This contains the headers from the file
            if (!areHeadersValid(receivedHeaders)) {
              throw new Error("Invalid file headers.");
            }

            // Process file data
            tempData.push({ fileName: file.name, data: results.data });
            setParsedData(tempData);
            setReviewState(ReviewStates.REVIEW);
          } catch (e) {
            console.error(e);
            // Update state to reflect error
            setReviewState(ReviewStates.FILE_MISMATCH_ERROR);
            // For example, set an error message in state to display to the user
          } finally {
            setParsing(false);
          }
        },
      });
    });
  }
  async function handleMismatchToStart() {
    setReviewState(ReviewStates.TABLE_SELECT);
  }
  // handlers
  const handleUpload = useCallback(async () => {
    try {
      setConfirmationDialogOpen(false);
      if (acceptedFiles.length === 0) {
        throw new Error("No files selected for upload.");
      }
      const fileToFormData = new FormData();
      acceptedFiles.forEach((file, index) => {
        fileToFormData.append(`file_${index}`, file);
      });
      const response = await fetch(`/api/upload?plot=${currentPlot?.key}&user=${session?.user?.name}&formType=${uploadForm}`, {
        method: 'POST',
        body: fileToFormData,
      });
      if (!response.ok) {
        throw new Error("Upload failed with status: " + response.status);
      }
      const data = await response.json();
      setErrorsData(data.errors);
      setUploaded(true);
    } catch (error: any) {
      console.error("Upload Error: ", error.message);
      // Optionally, update the UI to reflect the error
    }
  }, [acceptedFiles, currentPlot, session]);

  useEffect(() => {
    setExpectedHeaders(TableHeadersByFormType[uploadForm].map(item => item.label));
    if (reviewState == ReviewStates.UPLOAD) {
      if (!uploaded) {
        handleUpload().then();
      } else if (Object.keys(errorsData).length !== 0) {
        setReviewState(ReviewStates.ERRORS);
      } else {
        setReviewState(ReviewStates.UPLOADED);
      }
    }
  }, [errorsData, handleUpload, reviewState, uploaded]);


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

  const TableSelectState = () => (
    <Grid container spacing={2}>
      <Grid xs={5}>
        <Box sx={{display: 'flex', flexDirection: 'column', mb: 10, mr: 10}}>
          <Typography>
            Your file will need the correct headers in order to be uploaded to your intended table
            destination. Please review the table header requirements before continuing:
          </Typography>
          <Box sx={{display: 'flex', justifyContent: 'center'}}>
            <SelectFormType
              externalState={uploadForm}
              updateExternalState={setUploadForm}
            />
          </Box>
        </Box>
      </Grid>

      <Grid xs={2}>
        <Divider orientation="vertical" sx={{my: 4}}/>
      </Grid>

      <Grid xs={5}>
        <Box sx={{display: 'flex', flexDirection: 'column', mb: 10}}>
          <Box sx={{display: 'flex', flex: 1, justifyContent: 'center'}}>
            <Typography>
              {uploadForm !== '' && TableHeadersByFormType[uploadForm]?.map(obj => obj.label).join(', ')}
            </Typography>
          </Box>
          <LoadingButton disabled={uploadForm === ''} onClick={() => setReviewState(ReviewStates.PARSE)}>
            Continue
          </LoadingButton>
        </Box>
      </Grid>
    </Grid>
  )
  const ParseState = () => (
    <Grid container spacing={2}>
      <Grid xs={5}>
        <Box sx={{display: 'flex', flexDirection: 'column', mb: 10, mr: 10}}>
          <DropzoneLogic onChange={(acceptedFiles: FileWithPath[]) => {
            // rejectFile handling needs to go somewhere
            setAcceptedFiles((files) => acceptedFiles.concat(files));
          }}/>
        </Box>
      </Grid>

      <Grid xs={2}>
        <Divider orientation="vertical" sx={{my: 4}}/>
      </Grid>

      <Grid xs={5}>
        <Box sx={{display: 'flex', flexDirection: 'column', mb: 10}}>
          <Box sx={{display: 'flex', flex: 1, justifyContent: 'center'}}>
            <FileDisplay acceptedFiles={acceptedFiles}/>
          </Box>
          <LoadingButton disabled={acceptedFiles.length <= 0} loading={parsing} onClick={handleInitialSubmit}>
            Review Files
          </LoadingButton>
        </Box>
      </Grid>
    </Grid>
  )
  const ReviewState = () => (
    <Grid container spacing={2}>
      <Grid xs={5}>
        <Box sx={{display: 'flex', flexDirection: 'column', mb: 10, mr: 10}}>
          {parsedData && DisplayParsedData(parsedData.find((file) => file.fileName == acceptedFiles[dataViewActive - 1].name) ?? {
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
          <Button variant={"outlined"} onClick={handleApproval} className={"flex w-1/4 h-1/6 justify-center"}>
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
          <Button onClick={handleCancel}>Cancel</Button>
          <Button onClick={handleConfirm} autoFocus>
            Confirm
          </Button>
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
          </Typography>
          <Typography>{receivedHeaders.join(', ')}</Typography>
        </Box>
      </Grid>

      <Grid xs={2}>
        <Divider orientation="vertical" sx={{my: 4}}/>
      </Grid>

      <Grid xs={5}>
        <Box sx={{display: 'flex', flexDirection: 'column', mb: 10}}>
          <Box sx={{display: 'flex', flex: 1, justifyContent: 'center'}}>
            <Typography>However, you selected form {uploadForm}</Typography>
            <Typography>Which has headers: {expectedHeaders.join(', ')}</Typography>
          </Box>
          <LoadingButton disabled={acceptedFiles.length <= 0} loading={parsing} onClick={handleMismatchToStart}>
            Return to Table Selection
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
    const filesWithErrorsList: FileWithPath[] = [];
    console.log(`ERRORS FOUND`);
    if (Object.keys(errorsData).length) {
      acceptedFiles.forEach((file: FileWithPath) => {
        if (Object.keys(errorsData).includes(file.name.toString())) {
          filesWithErrorsList.push(file);
        }
      });
    }
    // Show errors with the data that were uploaded
    return (
      <Grid container spacing={2}>
        <Grid xs={5}>
          <Box sx={{display: 'flex', flexDirection: 'column', mb: 10, mr: 10}}>
            <DisplayErrorTable
              fileName={filesWithErrorsList[dataViewActive - 1].name}
              fileData={parsedData.find((file) => file.fileName == acceptedFiles[dataViewActive - 1].name) ?? {
                fileName: '',
                data: [],
              }}
              errorMessage={errorsData} formType={uploadForm}/>
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
        <Box className={"flex justify-center"}>
          Data was successfully uploaded! <br/>
          Please visit the Data page to view updated data.
        </Box>
      </Grid>
    </Grid>
  )

  switch (reviewState) {
    case ReviewStates.TABLE_SELECT:
      return <TableSelectState/>;
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
      return <FileMismatchErrorState />;
    default:
      return <div>Invalid State</div>;
  }
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

export function FileTabView() {
  const currentPlot = usePlotContext();
  if (!currentPlot) {
    return (
      <Box sx={{display: 'flex', gap: 1, alignItems: 'center'}}>
        <p>You must select a <b>plot</b> to continue!</p>
      </Box>
    );
  } else {
    // Tab system -- Browse page, Upload page
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
              <ViewUploadedCSVFiles/>
            </TabPanel>
            <TabPanel value={1}>
              <UploadAndReviewProcess/>
            </TabPanel>
          </Tabs>
        </Box>
      </Box>
    );
  }
}
