"use client";
import * as React from "react";
import {usePlotContext} from "@/app/plotcontext";
import {PlotSelection} from "@/components/plotselection";
import Box from "@mui/joy/Box";

export default function Page() {
  const currentPlot = usePlotContext();
  return (
    <>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <p>You have selected {currentPlot?.key ? currentPlot!.key : "nothing"}</p>
        {/*<PlotSelection />*/}
      </Box>
    </>
  );
}
