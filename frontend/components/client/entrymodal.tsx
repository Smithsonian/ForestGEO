"use client";

import React, {useEffect, useState} from "react";
import {
  useAttributeLoadDispatch,
  useCensusLoadDispatch,
  usePersonnelLoadDispatch,
  usePlotsLoadDispatch,
  useQuadratsLoadDispatch,
  useSpeciesLoadDispatch,
  useSubSpeciesLoadDispatch
} from "@/app/contexts/fixeddatacontext";
import {useFirstLoadContext, useFirstLoadDispatch, usePlotListDispatch} from "@/app/contexts/generalcontext";
import {
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Modal,
  ModalDialog,
  Stack,
  Typography
} from "@mui/joy";
import WarningRoundedIcon from "@mui/icons-material/WarningRounded";
import Divider from "@mui/joy/Divider";
import {redirect} from "next/navigation";
import {Plot} from "@/config/macros";
import {PlotRDS, QuadratRDS} from "@/config/sqlmacros";

export default function EntryModal() {
  const [loading, setLoading] = useState(0);
  const [loadingMsg, setLoadingMsg] = useState('');
  const attributeLoadDispatch = useAttributeLoadDispatch();
  const censusLoadDispatch = useCensusLoadDispatch();
  const personnelLoadDispatch = usePersonnelLoadDispatch();
  const quadratsLoadDispatch = useQuadratsLoadDispatch();
  const speciesLoadDispatch = useSpeciesLoadDispatch();
  const subSpeciesLoadDispatch = useSubSpeciesLoadDispatch();
  const plotsLoadDispatch = usePlotsLoadDispatch();
  const plotsListDispatch = usePlotListDispatch();
  const firstLoad = useFirstLoadContext();
  const firstLoadDispatch = useFirstLoadDispatch();
  const interval = 100 / 14;
  useEffect(() => {
    const fetchData = async () => {
      setLoading(loading + interval);
      setLoadingMsg('Retrieving Attributes...');
      let response = await fetch(`/api/fixeddata/attributes`, {method: 'GET'});
      setLoading(loading + interval);
      if (attributeLoadDispatch) {
        attributeLoadDispatch({attributeLoad: await response.json()});
      }
      setLoading(loading + interval);
      setLoadingMsg('Retrieving Census...');
      response = await fetch(`/api/fixeddata/census`, {method: 'GET'});
      setLoading(loading + interval);
      if (censusLoadDispatch) {
        censusLoadDispatch({censusLoad: await response.json()});
      }
      setLoading(loading + interval);
      setLoadingMsg('Retrieving Personnel...');
      response = await fetch(`/api/fixeddata/personnel`, {method: 'GET'});
      setLoading(loading + interval);
      if (personnelLoadDispatch) {
        personnelLoadDispatch({personnelLoad: await response.json()});
      }
      setLoading(loading + interval);
      setLoadingMsg('Retrieving Quadrats...');
      response = await fetch(`/api/fixeddata/quadrats`, {method: 'GET'});
      setLoading(loading + interval);
      let quadratRDS: QuadratRDS[] = await response.json();
      if (quadratsLoadDispatch) {
        quadratsLoadDispatch({quadratsLoad: quadratRDS});
      }
      setLoading(loading + interval);
      setLoadingMsg('Retrieving Species...');
      response = await fetch(`/api/fixeddata/species`, {method: 'GET'});
      setLoading(loading + interval);
      if (speciesLoadDispatch) {
        speciesLoadDispatch({speciesLoad: await response.json()});
      }
      setLoading(loading + interval);
      setLoadingMsg('Retrieving SubSpecies...');
      response = await fetch(`/api/fixeddata/subspecies`, {method: 'GET'});
      setLoading(loading + interval);
      if (subSpeciesLoadDispatch) {
        subSpeciesLoadDispatch({subSpeciesLoad: await response.json()});
      }
      setLoading(loading + interval)
      setLoadingMsg('Retrieving Plots...')
      response = await fetch(`/api/fixeddata/plots`, {method: 'GET'});
      setLoading(loading + interval);
      let plotRDSLoad: PlotRDS[] = await response.json();
      if (plotsLoadDispatch) {
        plotsLoadDispatch({plotsLoad: plotRDSLoad});
      }
      let plotList: Plot[] = [];
      for (const plotRDS of plotRDSLoad) {
        plotList.push({
          key: plotRDS.plotName ? plotRDS.plotName : "",
          num: quadratRDS.filter((quadrat) => quadrat.plotID == plotRDS.plotID).length
        });
      }
      if (plotsListDispatch) {
        plotsListDispatch({plotList: plotList});
      }
      setLoading(100);
      
    }
    fetchData().catch(console.error);
  }, []);
  
  return (
    <>
      {firstLoad ? <Modal open={firstLoad}
                          sx={{display: 'flex', flex: 1}}
                          onClose={(_event: React.MouseEvent<HTMLButtonElement>, reason: string) => {
                            if (reason !== 'backdropClick' && reason !== 'escapeKeyDown') {
                              firstLoadDispatch ? firstLoadDispatch({firstLoad: false}) : null
                            }
                          }}>
        <ModalDialog variant="outlined" role="alertdialog">
          <DialogTitle>
            <WarningRoundedIcon/>
            <Typography level={"title-lg"}>Welcome to the Application!</Typography>
          </DialogTitle>
          <Divider/>
          <DialogContent>
            <Stack direction={"column"} sx={{display: 'flex', flex: 1}}>
              {loading != 100 ?
                <>
                  <LinearProgress sx={{display: 'flex', flex: 1}} determinate size={"lg"} value={loading}/>
                  <Typography level="body-sm" color="neutral"><b>{loadingMsg}</b></Typography>
                </> :
                <>
                  <Typography level={"body-sm"}>Select <b>Core Measurements Hub</b> to view existing core
                    measurement data for a given plot, census, and quadrat</Typography>
                  <Typography level={"body-sm"}>Select <b>CSV & ArcGIS File Upload Hub</b> to upload core
                    measurements in either CSV format or in collected ArcGIS format</Typography>
                  <Typography level={"body-sm"}>Select <b>Measurement Properties Hub</b> to view and edit
                    measurement properties used in data collection</Typography>
                </>}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button variant="plain" color="neutral" disabled={loading != 100}
                    onClick={() => firstLoadDispatch ? firstLoadDispatch({firstLoad: false}) : null}>
              Continue
            </Button>
          </DialogActions>
        </ModalDialog>
      </Modal> : redirect('/dashboard')}
    </>
  );
}