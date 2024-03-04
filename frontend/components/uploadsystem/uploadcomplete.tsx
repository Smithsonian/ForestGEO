"use client";

import {UploadCompleteProps} from "@/config/macros";
import Typography from "@mui/joy/Typography";
import {Box, Link, Stack} from "@mui/joy";
import {redirect} from "next/navigation";

export default function UploadComplete(props: Readonly<UploadCompleteProps>) {
  const {uploadForm} = props;

  const showRedirectLink = () => {
    switch (uploadForm) {
      case 'fixeddata_codes':
        return (
          <Stack direction={'column'} sx={{alignItems: 'center'}}>
            <Typography variant={"solid"} level={"title-lg"} color={"success"}>Upload placed to: Attributes table</Typography>
            <Link onClick={() => redirect('/properties/attributes')}>Go to Attributes Table View</Link>
          </Stack>
        );
      case 'fixeddata_personnel':
        return (
          <Stack direction={'column'} sx={{alignItems: 'center'}}>
            <Typography variant={"solid"} level={"title-lg"} color={"success"}>Upload placed to: Personnel table</Typography>
            <Link onClick={() => redirect('/properties/personnel')}>Go to Personnel Table View</Link>
          </Stack>
        );
      case 'fixeddata_species':
        return (
          <Stack direction={'column'} sx={{alignItems: 'center'}}>
            <Typography variant={"solid"} level={"title-lg"} color={"success"}>Upload placed to: Species table</Typography>
            <Link onClick={() => redirect('/properties/species')}>Go to Species Table View</Link>
          </Stack>
        );
      case 'fixeddata_quadrat':
        return (
          <Stack direction={'column'} sx={{alignItems: 'center'}}>
            <Typography variant={"solid"} level={"title-lg"} color={"success"}>Upload placed to: Quadrats table</Typography>
            <Link onClick={() => redirect('/properties/quadrats')}>Go to Quadrats Table View</Link>
          </Stack>
        );
      case 'fixeddata_census':
        return (
          <Stack direction={'column'} sx={{alignItems: 'center'}}>
            <Typography variant={"solid"} level={"title-lg"} color={"success"}>Upload placed to: Core Measurements table</Typography>
            <Link onClick={() => redirect('/coremeasurementshub')}>Go to Core Measurements Table View</Link>
          </Stack>
        );
      case 'arcgis_files':
        return (
          <Stack direction={'column'} sx={{alignItems: 'center'}}>
            <Typography variant={"solid"} level={"title-lg"} color={"success"}>ArcGIS file(s) upload complete!</Typography>
          </Stack>
        );
      default:
        return (
          <Stack direction={'column'} sx={{alignItems: 'center'}}>
            <Typography variant={"solid"} level={"title-lg"} color={"danger"}>Unknown error in parsing upload form type. Please contact an administrator for assistance.</Typography>
          </Stack>
        );
    }
  }
  return (
    <Box sx={{display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'center'}}>
      <Typography variant={"solid"} level={"h1"} color={"success"}>Upload Complete!</Typography>
      {showRedirectLink()}
    </Box>
  );
}