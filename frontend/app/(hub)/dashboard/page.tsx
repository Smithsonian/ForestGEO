"use client";
import * as React from "react";
import {Box} from "@mui/joy";
import {useCensusContext, usePlotContext} from "@/app/contexts/userselectionprovider";

export default function DashboardPage() {
  let currentPlot = usePlotContext();
  let currentCensus = useCensusContext();

  if (!currentPlot || !currentCensus) {
    return (
      <Box sx={{display: 'flex', width: '100%', flexDirection: 'column', marginBottom: 5}}>
        In order to calculate Post-Census Summary Statistics, you must select a Plot and a Census from the sidebar!
      </Box>
    );
  }
  return (
    <Box sx={{display: 'flex', width: '100%', flexDirection: 'column', marginBottom: 5}}>

    </Box>
  );
}
