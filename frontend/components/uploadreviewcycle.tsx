"use client";
import React, {useCallback, useEffect, useState} from "react";
import {FileErrors, ReviewStates} from "@/config/macros";
import {FileWithPath} from "react-dropzone";
import {DataStructure, DisplayErrorTable, DisplayParsedData} from "@/components/fileupload/validationtable";
import {parse} from "papaparse";
import {usePlotContext} from "@/app/contexts/userselectioncontext";
import {useSession} from "next-auth/react";
import {
  Button,
  Card,
  CardContent,
  ClickAwayListener,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  LinearProgress,
  Pagination,
  Typography,
} from "@mui/material";
import LoadingButton from '@mui/lab/LoadingButton';
import {Dropdown, Menu, MenuButton, MenuItem, menuItemClasses} from "@mui/base";
import {styled} from '@mui/system';
import Divider from "@mui/joy/Divider";
import {DropzoneLogic} from "@/components/fileupload/dropzone";
import {FileDisplay} from "@/components/fileupload/filelist";

export function UploadAndReviewProcess() {
  let tempData: { fileName: string; data: DataStructure[] }[] = [];
  const initState: { fileName: string; data: DataStructure[] }[] = [];
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
  // validated error storage by row
  // const [errorRows, setErrorRows] = useState<{ [fileName: string]: RowDataStructure[] }>({})
  // pagination counter to manage validation table view/allow scroll through files in REVIEW
  const [dataViewActive, setDataViewActive] = useState(1);
  // for REVIEW --> storage of parsed data for display
  const [parsedData, setParsedData] = useState(initState);
  // Error report generation menu states:
  const [errDropdown, setErrDropdown] = useState(false);
  const [errMenuSelected, setErrMenuSelected] = useState("");
  // Confirmation menu states:
  const [dialogOpen, setDialogOpen] = React.useState(false);
  // etc.
  let currentPlot = usePlotContext();
  const {data: session} = useSession();
  
  const createHandleMenuClick = (menuItem: string) => {
    return () => {
      console.log(`Clicked on ${menuItem}`);
    };
  };
  
  const handleUpload = useCallback(async () => {
    setDialogOpen(false);
    if (acceptedFiles.length == 0) {
      console.log("accepted files is empty for some reason??");
    }
    const fileToFormData = new FormData();
    let i = 0;
    for (const file of acceptedFiles) {
      fileToFormData.append(`file_${i}`, file);
      i++;
    }
    const response = await fetch('/api/upload?plot=' + currentPlot!.key + '&user=' + session!.user!.name!, {
      method: 'POST',
      body: fileToFormData,
    });
    const data = await response.json();
    setErrorsData(await data.errors);
    // setErrorRows(await data.errorRows);
    setUploaded(true);
  }, [acceptedFiles, currentPlot, session]);
  
  useEffect(() => {
    if (reviewState == ReviewStates.UPLOAD) {
      if (!uploaded) {
        handleUpload().then();
      } else {
        if (Object.keys(errorsData).length !== 0) {
          setReviewState(ReviewStates.ERRORS);
        } else {
          setReviewState(ReviewStates.UPLOADED);
        }
      }
    }
  }, [errorsData, handleUpload, reviewState, uploaded]);
  0
  
  async function handleInitialSubmit() {
    setParsing(true);
    acceptedFiles.forEach((file: FileWithPath) => {
      parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: function (results: any) {
          try {
            // eslint-disable-next-line array-callback-return
            tempData.push({fileName: file.name, data: results.data});
            setParsedData(tempData);
          } catch (e) {
            console.log(e);
          }
        },
      });
    });
    setParsing(false);
    setReviewState(ReviewStates.REVIEW);
  }
  
  async function handleApproval() {
    setDialogOpen(true);
  }
  
  async function handleCancel() {
    setDialogOpen(false);
  }
  
  async function handleConfirm() {
    setDialogOpen(false);
    setReviewState(ReviewStates.UPLOAD);
  }
  
  async function handleOpenErrDropdown() {
    setErrDropdown(true);
  }
  
  async function handleCloseErrDropdown() {
    setErrDropdown(false);
  }
  
  const handleChange = (event: React.ChangeEvent<unknown>, value: number) => {
    setDataViewActive(value);
  };
// useEffect(() => {
  //   if (errMenuSelected != '') {
  //
  //   }
  // }, [errMenuSelected]);
  
  switch (reviewState) {
    case ReviewStates.PARSE:
      return (
        <>
          <div className={"grid grid-cols-2"}>
            <div>
              <DropzoneLogic onChange={(acceptedFiles: FileWithPath[]) => {
                // @todo: what about rejectedFiles?
                setAcceptedFiles((files) => acceptedFiles.concat(files));
              }}/>
            </div>
            <div className={"flex flex-col m-auto"}>
              <div className={"flex justify-center"}>
                <FileDisplay acceptedFiles={acceptedFiles}/>
              </div>
              <Divider className={"my-4"}/>
              <div className={"flex justify-center"}>
                <LoadingButton disabled={acceptedFiles.length <= 0} loading={parsing} onClick={handleInitialSubmit}>
                  Review Files
                </LoadingButton>
              </div>
            </div>
          </div>
        </>
      );
    case ReviewStates.REVIEW:
      if (!parsedData) throw new Error("parsing the accepted files failed. parsedData empty");
      return (
        <>
          <div className={"grid grid-cols-2"}>
            <div className={"mr-4"}>
              {/*{DisplayParsedData(parsedData.find((file) => file.fileName == acceptedFiles[dataViewActive - 1].name) || {*/}
              {/*  fileName: '',*/}
              {/*  data: [],*/}
              {/*})}*/}
              <Pagination count={acceptedFiles.length} page={dataViewActive} onChange={handleChange}/>
            </div>
            <div className={"flex justify-center w-2/4"}>
              <Button variant={"outlined"} onClick={handleApproval} className={"flex w-1/4 h-1/6 justify-center"}>
                Confirm Changes
              </Button>
            </div>
          </div>
          <div>
            <Dialog
              open={dialogOpen}
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
          </div>
        </>
      );
    case ReviewStates.UPLOAD:
      return (
        <>
          <div>
            <LinearProgress
              color={"primary"}
              aria-label="Uploading..."
              className="w-auto"
            />
          </div>
        </>
      );
    case ReviewStates.ERRORS:
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
        <>
          <div className={"flex flex-row gap-5 w-auto h-auto justify-center"}>
            <div className={"grid grid-cols-2"}>
              <div className={"flex flex-col flex-1 gap-5 w-auto h-auto justify-left"}>
                <DisplayErrorTable
                  fileName={filesWithErrorsList[dataViewActive - 1].name}
                  fileData={parsedData.find((file) => file.fileName == acceptedFiles[dataViewActive - 1].name) || {
                    fileName: '',
                    data: [],
                  }}
                  errorMessage={errorsData}/>
                <Pagination count={acceptedFiles.length} page={dataViewActive} onChange={handleChange}/>
              </div>
              <div>
                <ClickAwayListener onClickAway={handleCloseErrDropdown}>
                  <Dropdown onOpenChange={handleOpenErrDropdown}>
                    <TriggerButton>Dashboard</TriggerButton>
                    <Menu slots={{listbox: StyledListbox}}>
                      <StyledMenuItem onClick={createHandleMenuClick('Profile')}>
                        Profile
                      </StyledMenuItem>
                      <StyledMenuItem onClick={createHandleMenuClick('My account')}>
                        My account
                      </StyledMenuItem>
                      <StyledMenuItem onClick={createHandleMenuClick('Log out')}>
                        Log out
                      </StyledMenuItem>
                    </Menu>
                  </Dropdown>
                </ClickAwayListener>
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
              </div>
            </div>
          </div>
        </>
      );
    case ReviewStates.UPLOADED: // UPLOADED
      return (
        <>
          <div className={"grid grid-cols-2"}>
            <div className={"mr-4"}>
              {DisplayParsedData(parsedData.find((file) => file.fileName == acceptedFiles[dataViewActive - 1].name) || {
                fileName: '',
                data: [],
              })}
              <Pagination count={acceptedFiles.length} page={dataViewActive} onChange={handleChange}/>
            </div>
            <div className={"flex justify-center"}>
              Data was successfully uploaded! <br/>
              Please visit the Data page to view updated data.
            </div>
          </div>
        </>
      );
  }
}

const blue = {
  50: '#F0F7FF',
  100: '#DAECFF',
  200: '#99CCF3',
  300: '#66B2FF',
  400: '#3399FF',
  500: '#007FFF',
  600: '#0072E5',
  900: '#003A75',
};

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

const StyledListbox = styled('ul')(
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

const StyledMenuItem = styled(MenuItem)(
  ({theme}) => `
  list-style: none;
  padding: 8px;
  border-radius: 8px;
  cursor: default;
  user-select: none;

  &:last-of-type {
    border-bottom: none;
  }

  &.${menuItemClasses.focusVisible} {
    outline: 3px solid ${theme.palette.mode === 'dark' ? blue[600] : blue[200]};
    background-color: ${theme.palette.mode === 'dark' ? grey[800] : grey[100]};
    color: ${theme.palette.mode === 'dark' ? grey[300] : grey[900]};
  }

  &.${menuItemClasses.disabled} {
    color: ${theme.palette.mode === 'dark' ? grey[700] : grey[400]};
  }

  &:hover:not(.${menuItemClasses.disabled}) {
    background-color: ${theme.palette.mode === 'dark' ? grey[800] : grey[100]};
    color: ${theme.palette.mode === 'dark' ? grey[300] : grey[900]};
  }
  `,
);

const TriggerButton = styled(MenuButton)(
  ({theme}) => `
  font-family: IBM Plex Sans, sans-serif;
  font-weight: 600;
  font-size: 0.875rem;
  box-sizing: border-box;
  border-radius: 8px;
  padding: 8px 16px;
  line-height: 1.5;
  background: transparent;
  border: 1px solid ${theme.palette.mode === 'dark' ? grey[800] : grey[200]};
  color: ${theme.palette.mode === 'dark' ? blue[300] : blue[500]};
  cursor: pointer;

  transition-property: all;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 120ms;

  &:hover {
    background: ${theme.palette.mode === 'dark' ? grey[800] : grey[50]};
    border-color: ${theme.palette.mode === 'dark' ? grey[600] : grey[300]};
  }

  &:focus-visible {
    border-color: ${blue[400]};
    outline: 3px solid ${theme.palette.mode === 'dark' ? blue[500] : blue[200]};
  }
  `,
);