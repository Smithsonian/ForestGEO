"use client";
import {Spinner} from "@nextui-org/react";
import * as React from "react";

export default function Loading() {
  return (
    <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh'}}>
      <Spinner label={"Loading..."} color={"primary"} labelColor="primary" size={"sm"}/>;
    </div>
  );
}