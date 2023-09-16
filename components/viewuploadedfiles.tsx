"use client";
import React, {useCallback, useEffect, useState} from 'react';
import {
  Card,
  CardBody,
  CircularProgress,
  Divider,
  getKeyValue,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
} from '@nextui-org/react';
import {fileColumns, Plot, UploadedFileData} from "@/config/macros";
import {useSession} from "next-auth/react";
import {title} from "@/components/primitives";
import {CardHeader} from "@nextui-org/card";
import {BrowseError} from "@/app/error"
import {usePlotContext} from "@/app/plotcontext";

// @todo: look into using an ID other than plot name.
// @todo: react router URL params to pass in the ID for Browse.
//        https://reactrouter.com/en/main/start/tutorial#url-params-in-loaders
interface ViewUploadedFilesProp {
  plot: Plot;
  error?: Error;
  /** True when plot data has finished loading. */
  isLoaded: boolean;
  /** All the rows of data for the plot. */
  fileRows?: UploadedFileData[];
}

function LoadingFiles() {
  return (
    <>
      <Card className="flex flex-col items-center justify-center gap-4 py-8 md:py-10" radius={"none"}>
        <CardHeader>
          <div className="flex flex-col">
            <h5 className="text-md">Loading Files...</h5>
          </div>
        </CardHeader>
        <Divider className={"mt-6 mb-6"}/>
        <CardBody>
          <div className="flex flex-col">
            <CircularProgress value={60} size={"lg"} label={"Retrieving files..."}/>
          </div>
        </CardBody>
      </Card>
    </>
  );
}

function DisplayFiles({fileRows}: ViewUploadedFilesProp) {
  return (
    <>
      <Card className="flex flex-col items-center justify-center gap-4 py-8 md:py-10" radius={"sm"}>
        <CardHeader>
          <div className="flex flex-col">
            <h5 className="text-md">Uploaded Files</h5>
          </div>
        </CardHeader>
        <Divider className={"mt-6 mb-6"}/>
        <CardBody>
          <div className="flex flex-col">
            <Table aria-label={"Stored files"}>
              <TableHeader columns={fileColumns}>
                {(column) => <TableColumn key={column.key}>{column.label}</TableColumn>}
              </TableHeader>
              <TableBody items={fileRows}>
                {(fileItem) => ( // fileRows = fileItem[]; fileItem: {key, name, user, date}
                  <TableRow key={fileItem.key}>
                    {(columnKey) => <TableCell>{getKeyValue(fileItem, columnKey)}</TableCell>}
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardBody>
      </Card>
    </>
  );
}

export default function ViewUploadedFiles() {
  let localPlot = usePlotContext();
  // @TODO - implement remove and download files
  
  const [error, setError] = useState<Error>();
  const [isLoaded, setIsLoaded] = useState(false);
  const [fileRows, setFileRows] = useState<UploadedFileData[]>();
  const getListOfFiles = useCallback(async () => {
    if (localPlot && localPlot.key !== undefined) {
      let response = null;
      try {
        response = await fetch('/api/download?plot=' + localPlot.key, {
          method: 'GET',
        });
        
        if (!response.ok) {
          console.error('response.statusText', response.statusText);
          setError(new Error('API response not ok'));
        }
      } catch (e) {
        console.error(e);
        setError(new Error('API response not ok'));
      }
      
      if (response) {
        let data = await response.json();
        setFileRows(data.blobData);
        setIsLoaded(true);
      }
    } else {
      console.log('Plot is undefined');
      setError(new Error('No plot'));
    }
  }, [localPlot]);
  
  useEffect(() => {
    getListOfFiles().then();
  }, [getListOfFiles]);
  
  if ((!localPlot || !localPlot.key)) {
    return (
      <>
        <h1 className={title()}>Please select a plot to continue.</h1>
      </>
    );
  } else if (error) {
    return <BrowseError />
  } else if (!isLoaded || !fileRows) {
    return <LoadingFiles />
  } else {
    return <DisplayFiles error={error} isLoaded={isLoaded} fileRows={fileRows}  plot={localPlot!}/>
  }
}