"use client";
import * as React from "react";
import {
  useCensusContext,
  useFirstLoadContext,
  useFirstLoadDispatch,
  usePlotContext,
  useQuadratContext
} from "@/app/plotcontext";
import Box from "@mui/joy/Box";
import Typography from "@mui/joy/Typography";
import {Button, DialogActions, DialogContent, DialogTitle, Modal, ModalDialog, Stack} from "@mui/joy";
import Chip from "@mui/joy/Chip";
import {useEffect, useState} from "react";
import Divider from "@mui/joy/Divider";
import WarningRoundedIcon from '@mui/icons-material/WarningRounded';

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
    if (!currentPlot?.key && !currentCensus && !currentQuadrat) {
      return (
        <>
          <Box sx={{display: 'flex', gap: 1, alignItems: 'center'}}>
            <p>You must select a <b>plot</b>, <b>census</b>, and <b>quadrat</b> to continue!</p>
          </Box>
        </>
      );
    } else {
      return (
        <>
          <Stack direction={"column"}>
            <Typography display={"block"}>You have selected {currentPlot ? currentPlot!.key : "no plot"}</Typography>
            <Typography display={"block"}>You have selected {currentCensus ? currentCensus : "no census"}</Typography>
            <Typography display={"block"}>You have selected {currentQuadrat ? currentQuadrat : "no quadrat"}</Typography>
          </Stack>
        </>
      );
    }
  }
}
