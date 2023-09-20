"use client";
import * as React from "react";
import {usePlotContext} from "@/app/plotcontext";

export default function Page() {
  const currentPlot = usePlotContext();
  return (
    <>
      <p>You have selected {currentPlot?.key ? currentPlot!.key : "nothing"}</p>
    </>
  );
}
