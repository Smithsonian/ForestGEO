"use client";
import * as React from "react";
import {
  useCensusContext,
  useFirstLoadContext,
  useFirstLoadDispatch,
  usePlotContext,
  useQuadratContext
} from "@/app/plotcontext";
import {Button, DialogActions, DialogContent, DialogTitle, Grid, Modal, ModalDialog, Stack} from "@mui/joy";
import Divider from "@mui/joy/Divider";
import WarningRoundedIcon from '@mui/icons-material/WarningRounded';
import Box from "@mui/joy/Box";
import PersonnelBackground from '@/public/personneliconphoto.jpg';
import SpeciesBackground from '@/public/speciesiconphoto.jpg';
import AttributeBackground from '@/public/attributesiconphoto.jpg';
import CensusBackground from '@/public/censusiconphoto.jpg';
import QuadratBackground from '@/public/quadraticonphoto.jpg';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import DescriptionIcon from '@mui/icons-material/Description';
import GridOnIcon from '@mui/icons-material/GridOn';
import WidgetsIcon from '@mui/icons-material/Widgets';
import BugReportIcon from '@mui/icons-material/BugReport';
import {TemplateCard} from "@/components/iconselection";

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
              <WarningRoundedIcon/>
              Welcome to the Application!
            </DialogTitle>
            <Divider/>
            <DialogContent>
              <Stack direction={"column"}>
                Select <b>Data</b> to view existing data and manually add data to storage
                Select <b>Files</b> to add preformatted CSV data files to storage
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
