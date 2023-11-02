"use client";
import React, {useEffect, useState} from "react";
import {plots} from "@/config/macros";
import {usePlotDispatch} from "@/app/plotcontext";
import {useSession} from "next-auth/react";
import Select, {SelectStaticProps} from "@mui/joy/Select";
import Option from "@mui/joy/Option";
import {Button, Stack} from "@mui/joy";

export const PlotSelection = () => {
  const [age, setAge] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const skipRef = React.useRef(false);
  
  const handleChange = (
    event: React.SyntheticEvent | null,
    newValue: string | null,
  ) => {
    setAge(newValue!);
  };
  
  return (
    <Stack spacing={2} useFlexGap>
      <Button
        variant="solid"
        onMouseDown={() => {
          skipRef.current = true;
        }}
        onClick={() => {
          skipRef.current = false;
          setOpen((bool) => !bool);
        }}
      >
        Toggle the select
      </Button>
      <div>
        <Select
          listboxOpen={open}
          onListboxOpenChange={(isOpen) => {
            if (!skipRef.current) {
              setOpen(isOpen);
            }
          }}
          value={age}
          onChange={handleChange}
        >
          <Option value="">
            <em>None</em>
          </Option>
          <Option value={10}>Ten</Option>
          <Option value={20}>Twenty</Option>
          <Option value={30}>Thirty</Option>
        </Select>
      </div>
    </Stack>
  );
  // const {status} = useSession();
  // const dispatch = usePlotDispatch();
  // const keys = plots.map(plot => {
  //   return {
  //     key: plot.key
  //   };
  // });
  // const [value, setValue] = useState<string | null>(null);
  // const action: SelectStaticProps['action'] = React.useRef(null);
  // useEffect(() => {
  //   if (dispatch && value != null) {
  //     dispatch({
  //       plotKey: value!,
  //     });
  //   }
  // }, [dispatch, value]);
  // return (
  //   <>
  //     <Select
  //       action={action}
  //       value={value}
  //       placeholder="Select a plot..."
  //       onChange={(_e, newValue) => setValue(newValue)}
  //       sx={{ minWidth: 160 }}
  //     >
  //       {keys.map((keyItem, keyIndex) => (
  //         <Option key={keyIndex} value={keyItem.key}>{keyItem.key}</Option>
  //       ))}
  //     </Select>
  //   </>
  // );
}