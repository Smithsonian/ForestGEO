"use client";
import * as React from "react";
import {
  useCensusContext,
  useFirstLoadContext,
  useFirstLoadDispatch,
  usePlotContext,
  useQuadratContext
} from "@/app/plotcontext";
import {Button, DialogActions, DialogContent, DialogTitle, Modal, ModalDialog, Stack} from "@mui/joy";
import Divider from "@mui/joy/Divider";
import WarningRoundedIcon from '@mui/icons-material/WarningRounded';
import Typography from "@mui/joy/Typography";

export default function Page() {
  const currentPlot = usePlotContext();
  const currentCensus = useCensusContext();
  const currentQuadrat = useQuadratContext();
  const firstLoad = useFirstLoadContext();
  const firstLoadDispatch = useFirstLoadDispatch();
  if (firstLoad) {
    return (
      <>
        <Modal open={firstLoad} onClose={() => firstLoadDispatch ? firstLoadDispatch({firstLoad: false}) : null} sx={{display: 'flex', flexGrow: 1}}>
          <ModalDialog variant="outlined" role="alertdialog">
            <DialogTitle>
              <WarningRoundedIcon/>
              <Typography level={"title-lg"}>Welcome to the Application!</Typography>
            </DialogTitle>
            <Divider/>
            <DialogContent>
              <Stack direction={"column"}>
                <Typography level={"body-sm"}>Select <b>Data</b> to view existing data and manually add data to storage</Typography>
                <Typography level={"body-sm"}>Select <b>Files</b> to add preformatted CSV data files to storage</Typography>
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button variant="plain" color="neutral"
                      onClick={() => firstLoadDispatch ? firstLoadDispatch({firstLoad: false}) : null}>
                Continue
              </Button>
            </DialogActions>
          </ModalDialog>
        </Modal>
      </>
    );
  } else {
    return (
      <>
        Welcome!
      </>
    );
  }
}
