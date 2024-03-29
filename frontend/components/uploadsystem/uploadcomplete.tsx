"use client";

import {UploadCompleteProps} from "@/config/macros";
import Typography from "@mui/joy/Typography";
import {Box} from "@mui/joy";
import {redirect} from "next/navigation";
import React, {useEffect, useState} from "react";
import CircularProgress from "@mui/joy/CircularProgress";

export default function UploadComplete(props: Readonly<UploadCompleteProps>) {
  const {uploadForm, setIsUploadModalOpen} = props;
  const [countdown, setCountdown] = useState(5);

  // Effect for handling countdown and state transition
  useEffect(() => {
    let timer: number; // Declare timer as a number

    if (countdown > 0) {
      timer = window.setTimeout(() => setCountdown(countdown - 1), 1000) as unknown as number;
      // Use 'window.setTimeout' and type assertion to treat the return as a number
    } else if (countdown === 0) {
      setIsUploadModalOpen(false);
    }
    return () => clearTimeout(timer); // Clear timeout using the timer variable
  }, [countdown, setIsUploadModalOpen]);

  const redirectLink = () => {
    switch (uploadForm) {
      case 'attributes':
        return redirect('/properties/attributes');
      case 'personnel':
        return redirect('/properties/personnel');
      case 'species':
        return redirect('/properties/species');
      case 'quadrats':
        return redirect('/properties/quadrats');
      case 'measurements':
        return redirect('/measurementssummary');
      case 'arcgis_files':
        return redirect('/dashboard');
      default:
        return redirect('/dashboard');
    }
  }
  return (
    <Box sx={{display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'center'}}>
      <Typography variant={"solid"} level={"h1"} color={"success"}>Upload Complete!</Typography>
      {countdown > 0 && (
        <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
          <CircularProgress/>
          <Typography>{countdown} seconds remaining</Typography>
        </Box>
      )}
      {countdown === 0 && redirectLink()}
    </Box>
  );
}