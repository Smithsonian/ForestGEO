import Box from "@mui/joy/Box";
import {Grid} from "@mui/joy";
import {TemplateCard} from "@/components/iconselection";
import AttributeBackground from "@/public/attributesiconphoto.jpg";
import DescriptionIcon from "@mui/icons-material/Description";
import CensusBackground from "@/public/censusiconphoto.jpg";
import GridOnIcon from "@mui/icons-material/GridOn";
import PersonnelBackground from "@/public/personneliconphoto.jpg";
import AccountCircleIcon from "@mui/icons-material/AccountCircle";
import QuadratBackground from "@/public/quadraticonphoto.jpg";
import WidgetsIcon from "@mui/icons-material/Widgets";
import SpeciesBackground from "@/public/speciesiconphoto.jpg";
import BugReportIcon from "@mui/icons-material/BugReport";
import * as React from "react";

export default function Page() {
  return (
    <>
      <Box sx={{
        display: 'flex',
        flexGrow: 1,
        flexShrink: 1,
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        <Box sx={{
          display: 'flex',
          flexGrow: 1,
          overflow: 'hidden',
        }}>
          <Grid container columnSpacing={2} rowSpacing={2} sx={{flexGrow: 1}}>
            {/*FIRST ROW*/}
            <Grid xs={4}>
              {TemplateCard(AttributeBackground, <DescriptionIcon/>, "Attributes", "/properties/attributes")}
            </Grid>
            <Grid xs={4}>
              {TemplateCard(CensusBackground, <GridOnIcon/>, "Census", "/properties/census")}
            </Grid>
            <Grid xs={4}>
              {TemplateCard(PersonnelBackground, <AccountCircleIcon/>, "Personnel", "/properties/personnel")}
            </Grid>
            {/*SECOND ROW*/}
            <Grid xs={2}/>
            <Grid xs={4}>
              {TemplateCard(QuadratBackground, <WidgetsIcon/>, "Quadrats", "/properties/quadrats")}
            </Grid>
            <Grid xs={4}>
              {TemplateCard(SpeciesBackground, <BugReportIcon/>, "Species", "/properties/species")}
            </Grid>
            <Grid xs={2}/>
          </Grid>
        </Box>
      </Box>
    </>
  );
}