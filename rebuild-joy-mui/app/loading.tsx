"use client";
import * as React from "react";
import CircularProgress from "@mui/joy/CircularProgress";

export default function Loading() {
  return (
    <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh'}}>
      <CircularProgress color={"primary"} size={"sm"}>
        Loading...
      </CircularProgress>
    </div>
  );
}