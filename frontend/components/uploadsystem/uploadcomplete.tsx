"use client";

import {UploadCompleteProps} from "@/config/macros";
import Typography from "@mui/joy/Typography";
import {Box, Link, Stack} from "@mui/joy";
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

  const showRedirectLink = () => {
    switch (uploadForm) {
      case 'fixeddata_codes':
        return (
          <Stack direction={'column'} sx={{alignItems: 'center'}}>
            <Typography variant={"solid"} level={"title-lg"} color={"success"}>Upload placed to: Attributes
              table</Typography>
            <Link onClick={() => redirect('/properties/attributes')}>Go to Attributes Table View</Link>
          </Stack>
        );
      case 'fixeddata_personnel':
        return (
          <Stack direction={'column'} sx={{alignItems: 'center'}}>
            <Typography variant={"solid"} level={"title-lg"} color={"success"}>Upload placed to: Personnel
              table</Typography>
            <Link onClick={() => redirect('/properties/personnel')}>Go to Personnel Table View</Link>
          </Stack>
        );
      case 'fixeddata_species':
        return (
          <Stack direction={'column'} sx={{alignItems: 'center'}}>
            <Typography variant={"solid"} level={"title-lg"} color={"success"}>Upload placed to: Species
              table</Typography>
            <Link onClick={() => redirect('/properties/species')}>Go to Species Table View</Link>
          </Stack>
        );
      case 'fixeddata_quadrat':
        return (
          <Stack direction={'column'} sx={{alignItems: 'center'}}>
            <Typography variant={"solid"} level={"title-lg"} color={"success"}>Upload placed to: Quadrats
              table</Typography>
            <Link onClick={() => redirect('/properties/quadrats')}>Go to Quadrats Table View</Link>
          </Stack>
        );
      case 'fixeddata_census':
        return (
          <Stack direction={'column'} sx={{alignItems: 'center'}}>
            <Typography variant={"solid"} level={"title-lg"} color={"success"}>Upload placed to: Core
              Measurements table</Typography>
            <Link onClick={() => redirect('/coremeasurementshub')}>Go to Core Measurements Table View</Link>
          </Stack>
        );
      case 'arcgis_files':
        return (
          <Stack direction={'column'} sx={{alignItems: 'center'}}>
            <Typography variant={"solid"} level={"title-lg"} color={"success"}>ArcGIS file(s) upload
              complete!</Typography>
          </Stack>
        );
      default:
        return (
          <Stack direction={'column'} sx={{alignItems: 'center'}}>
            <Typography variant={"solid"} level={"title-lg"} color={"danger"}>Unknown error in parsing
              upload form type. Please contact an administrator for assistance.</Typography>
          </Stack>
        );
    }
  }
  return (
    <Box sx={{display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'center'}}>
      <Typography variant={"solid"} level={"h1"} color={"success"}>Upload Complete!</Typography>
      {showRedirectLink()}
      {countdown >= 0 && (
        <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
          <CircularProgress/>
          <Typography>{countdown} seconds remaining</Typography>
        </Box>
      )}
    </Box>
  );
}