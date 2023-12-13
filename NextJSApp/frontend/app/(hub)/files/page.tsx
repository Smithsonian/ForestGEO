"use client";
import * as React from "react";
import ViewUploadedFiles from "@/components/viewuploadedfiles";
import {UploadAndReviewProcess} from "@/components/uploadreviewcycle";
import {Tab, TabList, TabPanel, Tabs} from "@mui/joy";
import {usePlotContext} from "@/app/contexts/plotcontext";
import Box from "@mui/joy/Box";
import Typography from "@mui/joy/Typography";

// File Hub
export default function Files() {
  const currentPlot = usePlotContext();
  if (!currentPlot) {
    return (
      <>
        <Box sx={{display: 'flex', gap: 1, alignItems: 'center'}}>
          <p>You must select a <b>plot</b> to continue!</p>
        </Box>
      </>
    );
  } else {
    // Tab system -- Browse page, Upload page
    return (
      <>
        <Box sx={{display: 'flex', flexDirection: 'column', marginBottom: 5}}>
          <Typography level={"title-lg"} color={"primary"}>
            Drag and drop files into the box to upload them to storage
          </Typography>
          <Box sx={{mt: 5}}>
            <Tabs aria-label={"File Hub Options"} size={"sm"} className={""}>
              <TabList sticky={"top"}>
                <Tab>Browse Uploaded Files</Tab>
                <Tab>Upload New Files</Tab>
              </TabList>
              <TabPanel value={0}>
                <ViewUploadedFiles/>
              </TabPanel>
              <TabPanel value={1}>
                <UploadAndReviewProcess/>
              </TabPanel>
            </Tabs>
          </Box>
        </Box>
      </>
    );
  }
}
