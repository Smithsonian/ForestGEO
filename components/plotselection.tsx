"use client";
import {Select, Selection, SelectItem} from "@nextui-org/react";
import React, {useEffect, useState} from "react";
import {plots} from "@/config/macros";
import {usePlotDispatch} from "@/app/plotcontext";

export const SelectPlot = () => {
  const dispatch = usePlotDispatch();
  const keys = plots.map(plot => {
    return {
      key: plot.key
    };
  });
  const [selection, setSelection] = useState<Selection>(new Set([]));
  useEffect(() => {
    if (dispatch) {
      dispatch({
        plotKey: Array.from(selection)[0] as string,
      });
    }
  }, [dispatch, selection]);
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
        {(plotKey) => <SelectItem key={plotKey.key}>{plotKey.key}</SelectItem>}
      </Select>
    </>
  );
}