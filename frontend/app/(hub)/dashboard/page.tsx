"use client";
import * as React from "react";
import {Box} from "@mui/joy";
import {useCensusContext, usePlotContext} from "@/app/contexts/userselectionprovider";
import Typography from "@mui/joy/Typography";

export default function DashboardPage() {
  let currentPlot = usePlotContext();
  let currentCensus = useCensusContext();

  if (!currentPlot || !currentCensus) {
    return (
      <Box sx={{display: 'flex', width: '100%', flexDirection: 'column', marginBottom: 5}}>
        Please select a plot and census!
      </Box>
    );
  }
  return (
    <Box sx={{display: 'flex', width: '100%', flexDirection: 'column', marginBottom: 5}}>
      <Typography level={"title-lg"}>A brief overview of the application:</Typography>
      <br />
      <Typography level={"title-sm"}>If you observe the sidebar, there are 5 different options you can explore within this application.</Typography>
      <Typography level={"title-sm"}>Here is a brief overview of each one, how to use them, and how they all work together.</Typography>
      <Typography level={"title-sm"}>Please note that this is a work in progress, so changes will be made regularly.</Typography>
      <br />
      <br />
      <Typography level={"body-sm"}></Typography>
    </Box>
  );
}
