"use client";
import * as React from "react";
import Box from "@mui/joy/Box";
import {Grid} from "@mui/joy";
import {TemplateCard} from "@/components/iconselection";
import SatelliteAltIcon from '@mui/icons-material/SatelliteAlt';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CSVUploadBackground from '@/public/csvuploadiconphoto.jpg';
import ArcGISUploadBackground from '@/public/arcgisuploadiconphoto.jpg';

// File Hub
export default function Page() {
  return (
    <>
      {/*<FileTabView/>*/}
      <Box sx={{
        display: 'flex',
        flexGrow: 1,
        flexShrink: 1,
        flexDirection: 'column',
        overflow: 'hidden',
        width: '100%',
      }}>
        <Box sx={{
          display: 'flex',
          flexGrow: 1,
          overflow: 'hidden',
          alignItems: 'center',
          width: '100%',
        }}>
          <Grid container direction={"row"} justifyContent={"flex-start"} alignItems={"center"} columnSpacing={2} rowSpacing={2} sx={{display: 'flex', width: '100%'}}>
            {/*FIRST ROW*/}
            <Grid xs={5}>
              {TemplateCard(CSVUploadBackground, <UploadFileIcon/>, "Upload CSV File", "/fileuploadhub/csvfile")}
            </Grid>
            <Grid xs={2} />
            <Grid xs={5}>
              {TemplateCard(ArcGISUploadBackground, <SatelliteAltIcon/>, "Upload ArcGIS File", "/fileuploadhub/arcgisfile")}
            </Grid>
          </Grid>
        </Box>
      </Box>
    </>
  );
}
