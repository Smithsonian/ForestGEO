"use client";
import * as React from "react";
import {
  useCensusContext,
  useFirstLoadContext,
  useFirstLoadDispatch,
  usePlotContext,
  useQuadratContext
} from "@/app/plotcontext";
import Typography from "@mui/joy/Typography";
import {Button, DialogActions, DialogContent, DialogTitle, Grid, Modal, ModalDialog, Stack} from "@mui/joy";
import Divider from "@mui/joy/Divider";
import WarningRoundedIcon from '@mui/icons-material/WarningRounded';
import {AttributesCard, CensusCard, PersonnelCard, QuadratCard, SpeciesCard} from "@/components/iconselections";

export default function Page() {
  const currentPlot = usePlotContext();
  const currentCensus = useCensusContext();
  const currentQuadrat = useQuadratContext();
  const firstLoad = useFirstLoadContext();
  const firstLoadDispatch = useFirstLoadDispatch();
  if (firstLoad) {
    return (
      <>
        <Modal open={firstLoad} onClose={() => firstLoadDispatch ? firstLoadDispatch({firstLoad: false}) : null}>
          <ModalDialog variant="outlined" role="alertdialog">
            <DialogTitle>
              <WarningRoundedIcon />
              Welcome to the Application!
            </DialogTitle>
            <Divider />
            <DialogContent>
              <Stack direction={"column"}>
                Select <b>Data</b> to view existing data and manually add data to storage
                Select <b>Files</b> to add preformatted CSV data files to storage
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button variant="plain" color="neutral" onClick={() => firstLoadDispatch ? firstLoadDispatch({firstLoad: false}) : null}>
                Continue
              </Button>
            </DialogActions>
          </ModalDialog>
        </Modal>
      </>
    );
  }
  else {
    return (
      <>
        <Stack direction={"column"}>
          <Typography display={"block"}>You have selected {currentPlot ? currentPlot!.key : "no plot"}</Typography>
          <Typography display={"block"}>You have selected {currentCensus ? currentCensus : "no census"}</Typography>
          <Typography display={"block"}>You have selected {currentQuadrat ? currentQuadrat : "no quadrat"}</Typography>
          <Grid container spacing={2} sx={{flexGrow: 1}}>
            <Grid xs={5}>
              <PersonnelCard />
            </Grid>
            <Grid xs={2}>
            
            </Grid>
            <Grid xs={5}>
              <AttributesCard />
            </Grid>
            
            <Grid xs={3}>
            
            </Grid>
            <Grid xs={6}>
              <CensusCard />
            </Grid>
            <Grid xs={3}>
            
            </Grid>
            
            <Grid xs={5}>
              <QuadratCard />
            </Grid>
            <Grid xs={2}>
            
            </Grid>
            <Grid xs={5}>
              <SpeciesCard />
            </Grid>
          </Grid>
        </Stack>
      </>
    );
  }
}
