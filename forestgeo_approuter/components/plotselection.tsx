"use client";
import {Select, Selection, SelectItem} from "@nextui-org/react";
import React, {Dispatch, SetStateAction, useEffect, useState} from "react";
import {Plot, plots} from "@/config/site";

export interface PlotProps {
  plot: Plot;
  setPlot: Dispatch<SetStateAction<Plot>>;
}
export const SelectPlot = ({plot, setPlot}: PlotProps) => {
  const keys = plots.map(plot => {
    return {
      key: plot.key
    };
  });
  const [selection, setSelection] = useState<Selection>(new Set([]));
  
  useEffect(() => {
    setPlot(plots.find((plot) => (plot.key === Array.from(selection)[0])) as Plot);
  }, [selection, setPlot]);
  return (
    <>
      <Select
        label="Select Plot"
        variant="bordered"
        placeholder="Select a plot"
        className="max-w-xs"
        items={keys}
        selectedKeys={selection}
        onSelectionChange={setSelection}
      >
        {(plotKey) => <SelectItem key={plotKey.key}>{plotKey.key}</SelectItem> }
      </Select>
    </>
  );
}