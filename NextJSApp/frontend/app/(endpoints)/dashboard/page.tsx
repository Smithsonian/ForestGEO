"use client";
import * as React from "react";
import {useCensusContext, usePlotContext, useQuadratContext} from "@/app/plotcontext";
import Box from "@mui/joy/Box";

export default function Page() {
  const currentPlot = usePlotContext();
  const currentCensus = useCensusContext();
  const currentQuadrat = useQuadratContext();
  if (!currentPlot?.key) {
    return (
      <>
        <Box sx={{display: 'flex', gap: 1, alignItems: 'center'}}>
          <p>You must select a plot to continue!</p>
        </Box>
      </>
    );
  } else {
    return (
      <>
        <Box sx={{display: 'flex', gap: 1, alignItems: 'center'}}>
          <p>You have selected {currentPlot ? currentPlot!.key : "no plot"}</p>
          <br />
          <p>You have selected {currentCensus ? currentCensus : "no census"}</p>
          <br />
          <p>You have selected {currentQuadrat ? currentQuadrat : "no quadrat"}</p>
        </Box>
      </>
    );
  }
}
