"use client";
import * as React from "react";
import {useCensusContext, usePlotContext, useQuadratContext} from "@/app/plotcontext";
import Box from "@mui/joy/Box";
import Typography from "@mui/joy/Typography";
import {Stack} from "@mui/joy";

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
        <Stack direction={"column"}>
          <Box sx={{display: 'flex', gap: 1, alignItems: 'center', whiteSpace: "pre-wrap"}}>
            <Typography display={"block"}>You have selected {currentPlot ? currentPlot!.key : "no plot"}</Typography>
          </Box>
          <Box sx={{display: 'flex', gap: 1, alignItems: 'center', whiteSpace: "pre-wrap"}}>
            <Typography display={"block"}>You have selected {currentCensus ? currentCensus : "no census"}</Typography>
          </Box>
          <Box sx={{display: 'flex', gap: 1, alignItems: 'center', whiteSpace: "pre-wrap"}}>
            <Typography display={"block"}>You have selected {currentQuadrat ? currentQuadrat : "no quadrat"}</Typography>
          </Box>
        </Stack>
      </>
    );
  }
}
