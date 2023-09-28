"use client";
import React, {useCallback, useEffect, useState} from "react";
import {FileErrors, ReviewStates, RowDataStructure} from "@/config/macros";
import {FileWithPath} from "react-dropzone";
import {DataStructure, DisplayErrorTable, DisplayParsedData} from "@/components/validationtable";
import {parse} from "papaparse";
import {Divider, Pagination} from "@nextui-org/react";
import {DropzoneLogic, FileDisplay} from "@/components/filehandling";
import {usePlotContext} from "@/app/plotcontext";
import {useSession} from "next-auth/react";
import {
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Typography
} from "@mui/material";
import Button from '@mui/joy/Button';
import MenuButton from '@mui/joy/MenuButton';
import Menu from '@mui/joy/Menu';
import MenuItem from '@mui/joy/MenuItem';
import Dropdown from '@mui/joy/Dropdown';
import ListItemDecorator from '@mui/joy/ListItemDecorator';
import LinearProgress from '@mui/joy/LinearProgress';
import {createTheme, ThemeProvider} from "@mui/material/styles";
import {ClickAwayListener} from '@mui/base/ClickAwayListener';
import {CssVarsProvider} from "@mui/joy";

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
  },
});


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
  const [errorRows, setErrorRows] = useState<{ [fileName: string]: RowDataStructure[] }>({})
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
    setErrorRows(await data.errorRows);
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
  }, [errorsData, handleUpload, reviewState, uploaded]);0
  
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
  const createHandleCloseErrDropdown = (selectedItem: string) => () => {
    setErrMenuSelected(selectedItem);
    setErrDropdown(false);
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
                <Button disabled={acceptedFiles.length <= 0} loading={parsing} onClick={handleInitialSubmit}>
                  Review Files
                </Button>
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
              {DisplayParsedData(parsedData.find((file) => file.fileName == acceptedFiles[dataViewActive - 1].name) || {
                fileName: '',
                data: [],
              })}
              <Pagination total={acceptedFiles.length} page={dataViewActive} onChange={setDataViewActive}/>
            </div>
            <div className={"flex justify-center w-2/4"}>
              <Button variant={"outlined"} onClick={handleApproval} className={"flex w-1/6 h-1/6 justify-center"}>
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
              size="md"
              variant={"plain"}
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
                  errorMessage={errorsData} />
                <Pagination total={acceptedFiles.length} page={dataViewActive} onChange={setDataViewActive}/>
              </div>
              <div>
                <ClickAwayListener onClickAway={handleCloseErrDropdown}>
                  <Dropdown onOpenChange={handleOpenErrDropdown}>
                    <MenuButton size="sm">Generate Error Report</MenuButton>
                    <Menu size="sm">
                      <MenuItem selected={errMenuSelected == "downloadall"} onClick={createHandleCloseErrDropdown("downloadall")}>
                        <ListItemDecorator/>
                        Download All Rows
                      </MenuItem>
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
              <Pagination total={acceptedFiles.length} page={dataViewActive} onChange={setDataViewActive}/>
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