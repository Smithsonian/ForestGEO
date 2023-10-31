"use client";
import React, {useEffect, useState} from "react";
import {plots} from "@/config/macros";
import {usePlotDispatch} from "@/app/plotcontext";
import {useSession} from "next-auth/react";
import Select, {SelectStaticProps} from "@mui/joy/Select";
import Option from "@mui/joy/Option";

export const PlotSelection = () => {
  const {status} = useSession();
  const dispatch = usePlotDispatch();
  const keys = plots.map(plot => {
    return {
      key: plot.key
    };
  });
  const [value, setValue] = useState<string | null>(null);
  const action: SelectStaticProps['action'] = React.useRef(null);
  useEffect(() => {
    if (dispatch && value != null) {
      dispatch({
        plotKey: value!,
      });
    }
  }, [dispatch, value]);
  return (
    <>
      <Select
        action={action}
        value={value}
        placeholder="Select a plot..."
        onChange={(_e, newValue) => setValue(newValue)}
        sx={{ minWidth: 160 }}
      >
        {keys.map((keyItem, keyIndex) => (
          <Option key={keyIndex} value={keyItem.key}>{keyItem.key}</Option>
        ))}
      </Select>
    </>
  );
}