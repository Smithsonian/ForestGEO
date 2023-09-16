"use client";
import {subtitle, title} from "@/components/primitives";
import * as React from "react";
import {useSession} from "next-auth/react";
import {usePlotContext} from "@/app/plotcontext";
import {Tabs, Tab, Divider} from "@nextui-org/react";
import {FileUploader} from "@/components/fileuploader";
import ViewUploadedFiles from "@/components/viewuploadedfiles";

// File Hub
export default function Files() {
  useSession({
    required: true,
    onUnauthenticated() {
      return (
        <>
          <h3 className={title()}>You must log in to view this page.</h3>
        </>
      );
    },
  });
  // Tab system -- Browse page, Upload page
  return (
    <>
      <p className={subtitle()}>Drag and drop files into the box to upload them to storage</p>
      <div className={"mt-5"}>
        <Tabs aria-label={"File Hub Options"} size={"sm"} className={""}>
          <Tab key={"upload"} title={"Upload"} >
            <FileUploader />
          </Tab>
          <Tab key={"browse"} title={"Browse"} >
            <ViewUploadedFiles />
          </Tab>
        </Tabs>
      </div>
      
    </>
  );
}
