"use client";

import {useCensusContext, usePlotContext} from "@/app/contexts/userselectionprovider";
import ViewUploadedFiles from "@/components/uploadsystemhelpers/viewuploadedfiles";
import {useState} from "react";

export default function UploadedFilesPage() {
  const [refreshFileList, setRefreshFileList] = useState(false);
  const currentPlot = usePlotContext();
  const currentCensus = useCensusContext();

  return <ViewUploadedFiles currentPlot={currentPlot} currentCensus={currentCensus}
                            refreshFileList={refreshFileList}
                            setRefreshFileList={setRefreshFileList}/>;
}