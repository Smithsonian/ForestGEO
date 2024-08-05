"use client";

import { Box, Collapse, LinearProgress, LinearProgressProps, Slide, SlideProps, Typography } from "@mui/material";
import React from "react";

export function LinearProgressWithLabel(props: LinearProgressProps & { value?: number; currentlyrunningmsg?: string }) {
  return (
    <Box sx={{ display: "flex", flex: 1, alignItems: "center", flexDirection: "column" }}>
      <Box sx={{ width: "100%", mr: 1 }}>
        {props.value ? <LinearProgress variant="determinate" {...props} /> : <LinearProgress variant={"indeterminate"} {...props} />}
      </Box>
      <Box sx={{ minWidth: 35, display: "flex", flex: 1, flexDirection: "column" }}>
        {props.value ? (
          <Typography variant="body2" color="text.secondary">{`${Math.round(props?.value)}% --> ${props?.currentlyrunningmsg}`}</Typography>
        ) : (
          <Typography variant="body2" color="text.secondary">{`${props?.currentlyrunningmsg}`}</Typography>
        )}
      </Box>
    </Box>
  );
}

interface SlideToggleProps {
  isOpen: boolean;
  children: React.ReactNode;
}

export function SlideToggle({ isOpen, children }: SlideToggleProps) {
  return (
    <Collapse in={isOpen}>
      <Box sx={{ overflow: "hidden" }}>{children}</Box>
    </Collapse>
  );
}

interface TransitionComponentProps extends Omit<SlideProps, "children"> {
  children: React.ReactElement;
}

export const TransitionComponent: React.FC<TransitionComponentProps> = ({ children, ...props }) => <Slide {...props}>{children}</Slide>;
