"use client";
import React, {useEffect, useState} from 'react';
import {
  useAttributeLoadDispatch,
  useCensusLoadDispatch,
  useCoreMeasurementLoadDispatch,
  usePersonnelLoadDispatch,
  usePlotsLoadDispatch, useQuadratsLoadContext,
  useQuadratsLoadDispatch,
  useSpeciesLoadDispatch,
  useSubSpeciesLoadDispatch,
} from '@/app/contexts/fixeddatacontext';
import {
  useCensusListDispatch,
  useFirstLoadContext,
  useFirstLoadDispatch,
  usePlotListDispatch, useQuadratListContext, useQuadratListDispatch,
} from '@/app/contexts/generalcontext';
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
import {CensusRDS, PlotRDS, QuadratRDS} from '@/config/sqlmacros';
import {Census, Plot, Quadrat} from "@/config/macros";
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
  const censusListDispatch = useCensusListDispatch();
  const quadratListDispatch = useQuadratListDispatch();
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

  const fetchAndDispatchQuadrats = async() => {
    setLoading(loading + interval);
    setLoadingMsg('Retrieving Quadrats...');

    // check if quadratsLoad is available in localStorage
    const quadratLoadData = JSON.parse(localStorage.getItem('quadratsLoad') ?? 'null');
    let quadratsRDSLoad: QuadratRDS[];
    if (quadratLoadData) {
      quadratsRDSLoad = quadratLoadData;
    } else {
      const response = await fetch('/api/fixeddata/quadrats', {method: 'GET'});
      quadratsRDSLoad = await response.json();
      localStorage.setItem('quadratsLoad', JSON.stringify(quadratsRDSLoad));
    }

    if (quadratsLoadDispatch) {
      quadratsLoadDispatch({ quadratsLoad: quadratsRDSLoad});
    }

    const quadratListData = JSON.parse(localStorage.getItem('quadratList') ?? 'null');
    let quadratList: Quadrat[];
    if (quadratListData) {
      quadratList = quadratListData;
    } else {
      // Generate plotList from plotRDSLoad if not in localStorage
      quadratList = quadratsRDSLoad.map((quadratRDS) => ({
        quadratID: quadratRDS.quadratID!,
        plotID: quadratRDS.plotID!,
        quadratName: quadratRDS.quadratName!,
      }));
      localStorage.setItem('quadratList', JSON.stringify(quadratList));
    }

    setLoadingMsg('Dispatching Quadrat List...');
    if (quadratListDispatch) {
      quadratListDispatch({quadratList: quadratList});
    }
  }

  const fetchAndDispatchCensus = async () => {
    setLoading(loading + interval);
    setLoadingMsg('Retrieving Census...');

    // Check if plotsLoad data is available in localStorage
    const censusLoadData = JSON.parse(localStorage.getItem('censusLoad') ?? 'null');
    let censusRDSLoad: CensusRDS[];
    if (censusLoadData) {
      // Use data from localStorage if available
      censusRDSLoad = censusLoadData;
    } else {
      // Fetch data from the server if not in localStorage
      const response = await fetch('/api/fixeddata/census', {method: 'GET'});
      censusRDSLoad = await response.json();
      localStorage.setItem('censusLoad', JSON.stringify(censusRDSLoad));
    }

    if (censusLoadDispatch) {
      censusLoadDispatch({censusLoad: censusRDSLoad});
    }

    // Check if plotList data is available in localStorage
    const censusListData = JSON.parse(localStorage.getItem('censusList') ?? 'null');
    let censusList: Census[];
    if (censusListData) {
      censusList = censusListData;
    } else {
      const uniqueCensusMap = new Map<number, Census>();

      censusRDSLoad.forEach((censusRDS) => {
        const plotCensusNumber = censusRDS.plotCensusNumber ? censusRDS.plotCensusNumber : 0;
        if (!uniqueCensusMap.has(plotCensusNumber)) {
          // First occurrence of this plotCensusNumber
          uniqueCensusMap.set(plotCensusNumber, {
            plotID: censusRDS.plotID ? censusRDS.plotID : 0,
            plotCensusNumber,
            startDate: new Date(censusRDS.startDate!),
            endDate: new Date(censusRDS.endDate!),
            description: censusRDS.description ? censusRDS.description : ''
          });
        } else {
          // Update existing entry with earliest startDate and latest endDate
          const existingCensus = uniqueCensusMap.get(plotCensusNumber);
          if (existingCensus) {
            existingCensus.startDate = new Date(Math.min(existingCensus.startDate.getTime(), new Date(censusRDS.startDate!).getTime()));
            existingCensus.endDate = new Date(Math.max(existingCensus.endDate.getTime(), new Date(censusRDS.endDate!).getTime()));
          }
        }
      });

      censusList = Array.from(uniqueCensusMap.values());
      console.log(censusList);
      localStorage.setItem('censusList', JSON.stringify(censusList));
    }

    setLoadingMsg('Dispatching Census List...');
    if (censusListDispatch) {
      censusListDispatch({censusList: censusList});
    }
  }

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
    let plotList: Plot[];
    if (plotListData) {
      // Use data from localStorage if available
      plotList = plotListData;
    } else {
      // Generate plotList from plotRDSLoad if not in localStorage
      plotList = plotRDSLoad.map((plotRDS) => ({
        key: plotRDS.plotName ? plotRDS.plotName : '',
        num: quadratsLoadDispatch ? quadratsLoadDispatch.length : 0,
        id: plotRDS.plotID ? plotRDS.plotID : 0,
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
        const personnelLoadData = JSON.parse(localStorage.getItem('personnelLoad') ?? 'null');
        (personnelLoadData && personnelLoadDispatch) ?
          personnelLoadDispatch({personnelLoad: personnelLoadData}) :
          await fetchData('/api/fixeddata/personnel', personnelLoadDispatch, 'personnelLoad');
        const speciesLoadData = JSON.parse(localStorage.getItem('speciesLoad') ?? 'null');
        (speciesLoadData && speciesLoadDispatch) ?
          speciesLoadDispatch({speciesLoad: speciesLoadData}) :
          await fetchData('/api/fixeddata/species', speciesLoadDispatch, 'speciesLoad');
        const subSpeciesLoadData = JSON.parse(localStorage.getItem('subSpeciesLoad') ?? 'null');
        (subSpeciesLoadData && subSpeciesLoadDispatch) ?
          subSpeciesLoadDispatch({subSpeciesLoad: subSpeciesLoadData}) :
          await fetchData('/api/fixeddata/subspecies', subSpeciesLoadDispatch, 'subSpeciesLoad');

        await fetchAndDispatchPlots();
        await fetchAndDispatchCensus();
        await fetchAndDispatchQuadrats();
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