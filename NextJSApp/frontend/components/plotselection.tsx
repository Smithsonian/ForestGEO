"use client";
import React, {useEffect, useState} from "react";
import {plots} from "@/config/macros";
import {usePlotDispatch} from "@/app/plotcontext";
import {useSession} from "next-auth/react";
import Select, {SelectStaticProps} from "@mui/joy/Select";
import Option from "@mui/joy/Option";
import IconButton from "@mui/joy/IconButton";
import CloseRounded from '@mui/icons-material/CloseRounded';

export const SelectPlot = () => {
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
        onChange={(e, newValue) => setValue(newValue)}
        {...(value && {
          // display the button and remove select indicator
          // when user has selected a value
          endDecorator: (
            <IconButton
              size="sm"
              variant="plain"
              color="neutral"
              onMouseDown={(event) => {
                // don't open the popup when clicking on this button
                event.stopPropagation();
              }}
              onClick={() => {
                setValue(null);
                action.current?.focusVisible();
              }}
            >
              <CloseRounded />
            </IconButton>
          ),
          indicator: null,
        })}
        sx={{ minWidth: 160 }}
      >
        {keys.map((keyItem, keyIndex) => (
          <Option key={keyIndex} value={keyItem.key}>{keyItem.key}</Option>
        ))}
        <Option value="dog">Dog</Option>
        <Option value="cat">Cat</Option>
        <Option value="fish">Fish</Option>
        <Option value="bird">Bird</Option>
      </Select>
      {/*<Select*/}
      {/*  label="Select Plot"*/}
      {/*  variant="outlined"*/}
      {/*  placeholder="Select a plot"*/}
      {/*  className="max-w-xs"*/}
      {/*  items={keys}*/}
      {/*  selectedKeys={selection}*/}
      {/*  onSelectionChange={setSelection}*/}
      {/*  isDisabled={status !== "authenticated"}*/}
      {/*>*/}
      {/*  {(plotKey) => <Option value={plotKey.key}>{plotKey.key}</Option>}*/}
      {/*</Select>*/}
    </>
  );
}