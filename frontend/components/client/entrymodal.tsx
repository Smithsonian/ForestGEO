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
import {
  useCensusListDispatch,
  useFirstLoadContext,
  useFirstLoadDispatch,
  usePlotListDispatch,
  useQuadratListDispatch,
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
import {CensusRDS, PlotRDS, QuadratsRDS} from '@/config/sqlmacros';
import {Census, Plot, Quadrat} from "@/config/macros";
import {clearAllIDBData, getData, setData} from "@/config/db";

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
    const response = await fetch(url, { method: 'GET' });
    setLoading(loading + interval);
    setLoadingMsg('Dispatching...');
    if (dispatch) {
      const responseData = await response.json();
      dispatch({ [actionType]: responseData });
    }
  };

  const fetchAndDispatchQuadrats = async () => {
    setLoading(loading + interval);
    setLoadingMsg('Retrieving Census...');

    // Check if quadratsLoad is available in IndexedDB
    const quadratsLoadData = await getData('quadratsLoad');
    let quadratsRDSLoad: QuadratsRDS[];

    if (quadratsLoadData) {
      quadratsRDSLoad = quadratsLoadData;
    } else {
      const response = await fetch('/api/fixeddata/quadrats', { method: 'GET' });
      quadratsRDSLoad = await response.json();
      await setData('quadratsLoad', quadratsRDSLoad); // Save to IndexedDB
    }

    if (quadratsLoadDispatch) {
      quadratsLoadDispatch({ quadratsLoad: quadratsRDSLoad });
    }

    // Check if quadratList data is available in IndexedDB
    let quadratList: Quadrat[] = await getData('quadratList');

    if (!quadratList) {
      // Generate quadratList from quadratsRDSLoad if not in IndexedDB
      quadratList = quadratsRDSLoad.map((quadratRDS) => ({
        quadratID: quadratRDS.quadratID ? quadratRDS.quadratID : 0,
        plotID: quadratRDS.plotID ? quadratRDS.plotID : 0,
        quadratName: quadratRDS.quadratName ? quadratRDS.quadratName : '',
      }));
      await setData('quadratList', quadratList); // Save to IndexedDB
    }

    setLoadingMsg('Dispatching Census List...');
    if (quadratListDispatch) {
      quadratListDispatch({ quadratList: quadratList });
    }
  };

  const fetchAndDispatchCensus = async () => {
    setLoading(loading + interval);
    setLoadingMsg('Retrieving Census...');

    // Check if censusLoad data is available in IndexedDB
    let censusRDSLoad: CensusRDS[] = await getData('censusLoad');
    if (!censusRDSLoad) {
      // Fetch data from the server if not in IndexedDB
      const response = await fetch('/api/fixeddata/census', { method: 'GET' });
      censusRDSLoad = await response.json();
      await setData('censusLoad', censusRDSLoad); // Save to IndexedDB
    }

    if (censusLoadDispatch) {
      censusLoadDispatch({ censusLoad: censusRDSLoad });
    }

    // Check if censusList data is available in IndexedDB
    let censusList: Census[] = await getData('censusList');
    if (!censusList) {
      const uniqueCensusMap = new Map<number, Census>();
      censusRDSLoad.forEach((censusRDS) => {
        const plotCensusNumber = censusRDS.plotCensusNumber ?? 0;
        if (!uniqueCensusMap.has(plotCensusNumber)) {
          // First occurrence of this plotCensusNumber
          uniqueCensusMap.set(plotCensusNumber, {
            plotID: censusRDS.plotID ?? 0,
            plotCensusNumber,
            startDate: new Date(censusRDS.startDate!),
            endDate: new Date(censusRDS.endDate!),
            description: censusRDS.description ?? ''
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
      await setData('censusList', censusList); // Save to IndexedDB
    }

    setLoadingMsg('Dispatching Census List...');
    if (censusListDispatch) {
      censusListDispatch({ censusList: censusList });
    }
  };

  const fetchAndDispatchPlots = async () => {
    setLoading(loading + interval);
    setLoadingMsg('Retrieving Plots...');

    // Check if plotsLoad data is available in localStorage
    const plotsLoadData = await getData('plotsLoad');
    let plotRDSLoad: PlotRDS[];
    if (plotsLoadData) {
      // Use data from localStorage if available
      plotRDSLoad = plotsLoadData;
    } else {
      // Fetch data from the server if not in localStorage
      const response = await fetch('/api/fixeddata/plots', {method: 'GET'});
      plotRDSLoad = await response.json();
      await setData('plotsLoad', plotRDSLoad);
    }

    if (plotsLoadDispatch) {
      plotsLoadDispatch({plotsLoad: plotRDSLoad});
    }

    // Check if plotList data is available in localStorage
    const plotListData = await getData('plotList');
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
      await setData('plotList', plotList);
    }

    setLoadingMsg('Dispatching Plot List...');
    if (plotsListDispatch) {
      plotsListDispatch({plotList: plotList});
    }
  };

  useEffect(() => {
    const fetchDataEffect = async () => {
      try {
        await clearAllIDBData(); // at login for new user, reload all data --> user's permissions may affect what they can see
        const coreMeasurementLoadData = await getData('coreMeasurementLoad');
        if (coreMeasurementLoadData && coreMeasurementLoadDispatch) {
          coreMeasurementLoadDispatch({ coreMeasurementLoad: coreMeasurementLoadData });
        } else {
          await fetchData('/api/coremeasurements', coreMeasurementLoadDispatch, 'coreMeasurementLoad');
        }

        const attributeLoadData = await getData('attributeLoad');
        if (attributeLoadData && attributeLoadDispatch) {
          attributeLoadDispatch({ attributeLoad: attributeLoadData });
        } else {
          await fetchData('/api/fixeddata/attributes', attributeLoadDispatch, 'attributeLoad');
        }

        const personnelLoadData = await getData('personnelLoad');
        if (personnelLoadData && personnelLoadDispatch) {
          personnelLoadDispatch({ personnelLoad: personnelLoadData });
        } else {
          await fetchData('/api/fixeddata/personnel', personnelLoadDispatch, 'personnelLoad');
        }

        const speciesLoadData = await getData('speciesLoad');
        if (speciesLoadData && speciesLoadDispatch) {
          speciesLoadDispatch({ speciesLoad: speciesLoadData });
        } else {
          await fetchData('/api/fixeddata/species', speciesLoadDispatch, 'speciesLoad');
        }

        const subSpeciesLoadData = await getData('subSpeciesLoad');
        if (subSpeciesLoadData && subSpeciesLoadDispatch) {
          subSpeciesLoadDispatch({ subSpeciesLoad: subSpeciesLoadData });
        } else {
          await fetchData('/api/fixeddata/subspecies', subSpeciesLoadDispatch, 'subSpeciesLoad');
        }

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