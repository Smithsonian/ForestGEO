"use client";
import {subtitle} from "@/components/primitives";
import {usePlotContext} from "@/app/plotcontext";
import * as React from "react";


// Data Hub
export default function Data() {
  const currentPlot = usePlotContext();
  return (
    <>
      <p className={subtitle()}>You have selected {currentPlot?.key ? currentPlot!.key : "nothing"}</p>
    </>
  );
}