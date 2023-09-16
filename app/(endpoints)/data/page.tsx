"use client";
import {useSession} from "next-auth/react";
import {subtitle, title} from "@/components/primitives";
import {usePlotContext} from "@/app/plotcontext";
import * as React from "react";
import {Divider, Tab, Tabs} from "@nextui-org/react";
import {FileUploader} from "@/components/fileuploader";
import ViewUploadedFiles from "@/components/viewuploadedfiles";


// Data Hub
export default function Data() {
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
  const currentPlot = usePlotContext();
  return (
    <>
      <p className={subtitle()}>You have selected {currentPlot?.key ? currentPlot!.key : "nothing"}</p>
    </>
  );
}