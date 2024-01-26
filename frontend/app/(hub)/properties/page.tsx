import Box from "@mui/joy/Box";
import * as React from "react";

export default function PropertiesPage() {
  return (
    <Box sx={{
      display: 'flex',
      flex: 1,
      flexDirection: 'column',
      overflow: 'hidden'
    }}>
      <Box sx={{
        display: 'flex',
        flex: 1,
        overflow: 'hidden',
      }}>
        {/*<Grid container columnSpacing={2} rowSpacing={2} sx={{flex: 1, width: '100%'}}>*/}
        {/*  /!*FIRST ROW*!/*/}
        {/*  <Grid xs={4}>*/}
        {/*    {TemplateCard(AttributeBackground, <DescriptionIcon/>, "Attributes", "/properties/attributes")}*/}
        {/*  </Grid>*/}
        {/*  <Grid xs={4}>*/}
        {/*    {TemplateCard(CensusBackground, <GridOnIcon/>, "Census", "/properties/census")}*/}
        {/*  </Grid>*/}
        {/*  <Grid xs={4}>*/}
        {/*    {TemplateCard(PersonnelBackground, <AccountCircleIcon/>, "Personnel", "/properties/personnel")}*/}
        {/*  </Grid>*/}
        {/*  /!*SECOND ROW*!/*/}
        {/*  <Grid xs={2}/>*/}
        {/*  <Grid xs={4}>*/}
        {/*    {TemplateCard(QuadratBackground, <WidgetsIcon/>, "Quadrats", "/properties/quadrats")}*/}
        {/*  </Grid>*/}
        {/*  <Grid xs={4}>*/}
        {/*    {TemplateCard(SpeciesBackground, <BugReportIcon/>, "Species", "/properties/species")}*/}
        {/*  </Grid>*/}
        {/*  <Grid xs={2}/>*/}
        {/*</Grid>*/}
      </Box>
    </Box>
  );
}