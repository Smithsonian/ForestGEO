"use client";
import React, {useState} from "react";
import {FileErrors, ReviewStates, tableHeaders} from "@/config/macros";
import {FileWithPath} from "react-dropzone";
import {DataStructure, DisplayParsedData, ValidationErrorTable} from "@/components/validationtable";
import {parse} from "papaparse";
import {Button, Divider, Pagination, Spinner} from "@nextui-org/react";
import {DropzoneLogic, FileDisplay} from "@/components/fileuploader";
import {usePlotContext} from "@/app/plotcontext";
import {useSession} from "next-auth/react";
import {subtitle} from "@/components/primitives";

export function UploadAndReviewProcess () {
  let tempData: { fileName: string; data: DataStructure[] }[] = [];
  const initState: { fileName: string; data: DataStructure[] }[] = [];
  // in progress states
  const [parsing, setParsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  // core enum to handle state progression
  const [reviewState, setReviewState] = useState<ReviewStates>(ReviewStates.PARSE);
  // dropped file storage
  const [acceptedFiles, setAcceptedFiles] = useState<FileWithPath[]>([]);
  // validated error storage
  const [errorsData, setErrorsData] = useState<FileErrors>({});
  // pagination counter to manage validation table view/allow scroll through files in REVIEW
  const [dataViewActive, setDataViewActive] = useState(1);
  // for REVIEW --> storage of parsed data for display
  const [parsedData, setParsedData] = useState(initState);
  let currentPlot = usePlotContext();
  const {data: session} = useSession();
  async function handleInitialSubmit() {
    setParsing(true);
    acceptedFiles.forEach((file: FileWithPath) => {
      parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: function (results: any) {
          try {
            // eslint-disable-next-line array-callback-return
            tempData.push({ fileName: file.name, data: results.data });
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
    setReviewState(ReviewStates.UPLOAD);
  }
  
  async function handleUpload() {
    setUploading(true);
    if (acceptedFiles.length === 0) {
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
    setErrorsData(data.errors);
    setUploading(false);
    if (errorsData && Object.keys(errorsData).length === 0) setReviewState(ReviewStates.UPLOADED);
    else setReviewState(ReviewStates.ERRORS);
  }
  
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
              <Divider className={"my-4"} />
              <div className={"flex justify-center"}>
                <Button isDisabled={acceptedFiles.length <= 0} isLoading={parsing} onClick={handleInitialSubmit} spinnerPlacement={"start"} spinner={<Spinner color={"primary"} size={"sm"} />}>
                  Upload to server
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
              {DisplayParsedData(parsedData.find((file) => file.fileName === acceptedFiles[dataViewActive - 1].name) || {
                fileName: '',
                data: [],
              })}
              <Pagination total={acceptedFiles.length} page={dataViewActive} onChange={setDataViewActive} />
            </div>
            <div className={"flex justify-center"}>
              <Button onClick={handleApproval}>
                Confirm Changes
              </Button>
            </div>
          </div>
        </>
      );
    case ReviewStates.UPLOAD:
      return (
        <>
          <div className={"grid grid-cols-2"}>
            <div className={"mr-4"}>
              {DisplayParsedData(parsedData.find((file) => file.fileName === acceptedFiles[dataViewActive - 1].name) || {
                fileName: '',
                data: [],
              })}
              <Pagination total={acceptedFiles.length} page={dataViewActive} onChange={setDataViewActive} />
            </div>
            <div className={"flex justify-center"}>
              <Button isLoading={uploading} onClick={handleUpload} spinnerPlacement={"start"} spinner={<Spinner color={"primary"} size={"sm"} />}>
                Upload
              </Button>
            </div>
          </div>
        </>
      );
    case ReviewStates.ERRORS:
      const filesWithErrorsList: FileWithPath[] = [];
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
          <div className={"flex flex-col gap-5 w-3/5 h-3/5 justify-center"}>
            <ValidationErrorTable
              errorMessage={errorsData}
              uploadedData={filesWithErrorsList}
              headers={tableHeaders}
            />
          </div>
        </>
      );
    case ReviewStates.UPLOADED: // UPLOADED
      return (
        <div>
          {/*REVIEW UPLOAD CONTENT HERE*/}
          <p className={subtitle()}>
            Successfully uploaded.
          </p>
        </div>
      );
  }
}