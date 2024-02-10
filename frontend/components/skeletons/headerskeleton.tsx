"use client";
import React from "react";
import {Skeleton} from "@mui/joy";

function HeaderSkeleton() {
  return (
    <Skeleton variant="rectangular" height={60} width="100%"/>
  );
}

export default HeaderSkeleton;