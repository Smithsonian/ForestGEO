"use client";
import React, {useCallback, useState} from 'react';
import {useSession} from "next-auth/react";
import {DropzoneProps, DropzonePureProps, FileErrors, FileListProps, UploadValidationProps} from "@/config/macros";
import {ValidationTable} from "@/components/fileupload/validationtable";
import {usePlotContext} from "@/app/contexts/plotcontext";
import {FileRejection, FileWithPath, useDropzone} from 'react-dropzone';
import {parse, ParseConfig} from 'papaparse';
import {FileUploadIcon} from "@/components/icons";

import '@/styles/dropzone.css';
import {subtitle} from "@/config/primitives";
import {Card, CardContent, CardHeader, Pagination} from "@mui/material";
import {Skeleton} from "@mui/joy";
import Chip from "@mui/joy/Chip";
import Divider from "@mui/joy/Divider";
import LoadingButton from "@mui/lab/LoadingButton";
/**
 * A simple list of files with their sizes.
 */
export function FileDisplay({acceptedFiles}: FileListProps) {
  const [currentPage, setCurrentPage] = React.useState(1);
  const handleChange = (event: React.ChangeEvent<unknown>, value: number) => {
    setCurrentPage(value);
  };
  return (
    <>
      <Card className={"flex flex-1 justify-center w-auto"}>
        <CardHeader>
          File Preview:
        </CardHeader>
        <CardContent>
          <Skeleton loading={acceptedFiles?.length > 0} className={"rounded-lg"}>
            <div className={"flex flex-1 flex-col h-auto rounded-lg"}>
              <div>
                File Name: <br/>
                <Chip
                  color={"primary"}>{(acceptedFiles?.length > 0 && acceptedFiles[currentPage - 1].path) ? acceptedFiles[currentPage - 1].path! : ''}</Chip>
              </div>
              <Divider className={"my-2"}/>
              <div>
                File Size: <br/>
                <Chip
                  color={"primary"}>{(acceptedFiles?.length > 0 && acceptedFiles[currentPage - 1].size) ? acceptedFiles[currentPage - 1].size! : ''} bytes</Chip>
              </div>
            </div>
          </Skeleton>
        </CardContent>
        <div className={"flex justify-center"}>
          {acceptedFiles.length > 1 && <Pagination count={acceptedFiles.length} color={"secondary"} page={currentPage}
                                                   onChange={handleChange}/>}
        </div>
      </Card>
    </>
  );
}