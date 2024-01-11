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
      const responseData = await response.json();
      dispatch({[actionType]: responseData});
      localStorage.setItem(actionType, JSON.stringify(responseData));
    }
  };

  const fetchAndDispatchPlots = async () => {
    setLoading(loading + interval);
    setLoadingMsg('Retrieving Plots...');

    // Check if plotsLoad data is available in localStorage
    const plotsLoadData = JSON.parse(localStorage.getItem('plotsLoad') ?? 'null');
    let plotRDSLoad: PlotRDS[];
    if (plotsLoadData) {
      // Use data from localStorage if available
      plotRDSLoad = plotsLoadData;
    } else {
      // Fetch data from the server if not in localStorage
      const response = await fetch('/api/fixeddata/plots', {method: 'GET'});
      plotRDSLoad = await response.json();
      localStorage.setItem('plotsLoad', JSON.stringify(plotRDSLoad));
    }

    if (plotsLoadDispatch) {
      plotsLoadDispatch({plotsLoad: plotRDSLoad});
    }

    // Check if plotList data is available in localStorage
    const plotListData = JSON.parse(localStorage.getItem('plotList') ?? 'null');
    let plotList: PlotData[];
    if (plotListData) {
      // Use data from localStorage if available
      plotList = plotListData;
    } else {
      // Generate plotList from plotRDSLoad if not in localStorage
      plotList = plotRDSLoad.map((plotRDS) => ({
        key: plotRDS.plotName ? plotRDS.plotName : '',
        num: quadratsLoadDispatch ? quadratsLoadDispatch.length : 0,
        id: plotRDS.plotID,
      }));
      localStorage.setItem('plotList', JSON.stringify(plotList));
    }

    setLoadingMsg('Dispatching Plot List...');
    if (plotsListDispatch) {
      plotsListDispatch({plotList: plotList});
    }
  };

  useEffect(() => {
    const fetchDataEffect = async () => {
      try {
        const coreMeasurementLoadData = JSON.parse(localStorage.getItem('coreMeasurementLoad') ?? 'null');
        (coreMeasurementLoadData && coreMeasurementLoadDispatch) ?
          coreMeasurementLoadDispatch({coreMeasurementLoad: coreMeasurementLoadData}) :
          await fetchData('/api/coremeasurements', coreMeasurementLoadDispatch, 'coreMeasurementLoad');
        const attributeLoadData = JSON.parse(localStorage.getItem('attributeLoad') ?? 'null');
        (attributeLoadData && attributeLoadDispatch) ?
          attributeLoadDispatch({attributeLoad: attributeLoadData}) :
          await fetchData('/api/fixeddata/attributes', attributeLoadDispatch, 'attributeLoad');
        const censusLoadData = JSON.parse(localStorage.getItem('censusLoad') ?? 'null');
        (censusLoadData && censusLoadDispatch) ?
          censusLoadDispatch({censusLoad: censusLoadData}) :
          await fetchData('/api/fixeddata/census', censusLoadDispatch, 'censusLoad');
        const personnelLoadData = JSON.parse(localStorage.getItem('personnelLoad') ?? 'null');
        (personnelLoadData && personnelLoadDispatch) ?
          personnelLoadDispatch({personnelLoad: personnelLoadData}) :
          await fetchData('/api/fixeddata/personnel', personnelLoadDispatch, 'personnelLoad');
        const quadratsLoadData = JSON.parse(localStorage.getItem('quadratsLoad') ?? 'null');
        (quadratsLoadData && quadratsLoadDispatch) ?
          quadratsLoadDispatch({quadratsLoad: quadratsLoadData}) :
          await fetchData('/api/fixeddata/quadrats', quadratsLoadDispatch, 'quadratsLoad');
        const speciesLoadData = JSON.parse(localStorage.getItem('speciesLoad') ?? 'null');
        (speciesLoadData && speciesLoadDispatch) ?
          speciesLoadDispatch({speciesLoad: speciesLoadData}) :
          await fetchData('/api/fixeddata/species', speciesLoadDispatch, 'speciesLoad');
        const subSpeciesLoadData = JSON.parse(localStorage.getItem('subSpeciesLoad') ?? 'null');
        (subSpeciesLoadData && subSpeciesLoadDispatch) ?
          subSpeciesLoadDispatch({subSpeciesLoad: subSpeciesLoadData}) :
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