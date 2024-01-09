"use client";
import React, {useEffect, useState} from 'react';
import {
  useAttributeLoadDispatch,
  useCensusLoadDispatch,
  useCoreMeasurementLoadDispatch,
  usePersonnelLoadDispatch,
  usePlotsLoadDispatch,
  useQuadratsLoadDispatch,
  useSpeciesLoadDispatch,
  useSubSpeciesLoadDispatch,
} from '@/app/contexts/fixeddatacontext';
import {useFirstLoadContext, useFirstLoadDispatch, usePlotListDispatch,} from '@/app/contexts/generalcontext';
import {
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Modal,
  ModalDialog,
  Stack,
  Typography,
} from '@mui/joy';
import WarningRoundedIcon from '@mui/icons-material/WarningRounded';
import Divider from '@mui/joy/Divider';
import {redirect} from 'next/navigation';
import {PlotRDS} from '@/config/sqlmacros';

interface PlotData {
  key: string;
  num: number;
  id: number;
}

export default function EntryModal() {
  const [loading, setLoading] = useState(0);
  const [loadingMsg, setLoadingMsg] = useState('');
  const coreMeasurementLoadDispatch = useCoreMeasurementLoadDispatch();
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
  const interval = 5;

  const fetchData = async (url: string, dispatch: Function | null, actionType: string) => {
    setLoading(loading + interval);
    setLoadingMsg(`Retrieving ${actionType}...`);
    const response = await fetch(url, {method: 'GET'});
    setLoading(loading + interval);
    setLoadingMsg('Dispatching...');
    if (dispatch) {
      dispatch({[actionType]: await response.json()});
    }
  };

  const fetchAndDispatchPlots = async () => {
    setLoading(loading + interval);
    setLoadingMsg('Retrieving Plots...');
    const response = await fetch('/api/fixeddata/plots', {method: 'GET'});
    setLoading(loading + interval);
    setLoadingMsg('Dispatching...');
    const plotRDSLoad: PlotRDS[] = await response.json();
    if (plotsLoadDispatch) {
      plotsLoadDispatch({plotsLoad: plotRDSLoad});
    }

    const plotList: PlotData[] = plotRDSLoad.map((plotRDS) => ({
      key: plotRDS.plotName ? plotRDS.plotName : '',
      num: quadratsLoadDispatch ? quadratsLoadDispatch.length : 0,
      id: plotRDS.plotID,
    }));

    setLoadingMsg('Dispatching Plot List...');
    if (plotsListDispatch) {
      plotsListDispatch({plotList});
    }
  };

  useEffect(() => {
    const fetchDataEffect = async () => {
      try {
        await fetchData('/api/coremeasurements', coreMeasurementLoadDispatch, 'coreMeasurementLoad');
        await fetchData('/api/fixeddata/attributes', attributeLoadDispatch, 'attributeLoad');
        await fetchData('/api/fixeddata/census', censusLoadDispatch, 'censusLoad');
        await fetchData('/api/fixeddata/personnel', personnelLoadDispatch, 'personnelLoad');
        await fetchData('/api/fixeddata/quadrats', quadratsLoadDispatch, 'quadratsLoad');
        await fetchData('/api/fixeddata/species', speciesLoadDispatch, 'speciesLoad');
        await fetchData('/api/fixeddata/subspecies', subSpeciesLoadDispatch, 'subSpeciesLoad');

        await fetchAndDispatchPlots();
        setLoading(100);
      } catch (error) {
        console.error(error);
      }
    };

    fetchDataEffect().catch(console.error);
  }, []);

  return (
    <>
      {firstLoad ? <Modal open={firstLoad}
                          sx={{display: 'flex', flex: 1}}
                          onClose={(_event: React.MouseEvent<HTMLButtonElement>, reason: string) => {
                            if (reason !== 'backdropClick' && reason !== 'escapeKeyDown') {
                              return firstLoadDispatch ? firstLoadDispatch({firstLoad: false}) : null
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