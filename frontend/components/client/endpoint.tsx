"use client";
import * as React from "react";
import {useEffect, useState} from "react";
import {useSession} from "next-auth/react";
import {redirect, usePathname, useRouter} from "next/navigation";
import {subtitle, title} from "@/config/primitives";
import Sidebar from "@/components/sidebar";
import Header from "@/components/header";
import {Box} from "@mui/joy";
import Divider from "@mui/joy/Divider";
import {Census, Plot, Quadrat, siteConfig} from "@/config/macros";
import {
  useAttributeLoadDispatch,
  useCensusLoadDispatch,
  useCoreMeasurementLoadDispatch,
  usePersonnelLoadDispatch,
  usePlotsLoadDispatch,
  useQuadratsLoadDispatch,
  useSpeciesLoadDispatch,
  useSubSpeciesLoadDispatch
} from "@/app/contexts/fixeddatacontext";
import {useCensusListDispatch, usePlotListDispatch, useQuadratListDispatch} from "@/app/contexts/generalcontext";
import {CensusRDS, PlotRDS, QuadratsRDS} from "@/config/sqlmacros";

function renderSwitch(endpoint: string) {
  switch (endpoint) {
    case '/dashboard':
      return (
        <h3 className={title({color: "cyan"})} key={endpoint}>Dashboard View</h3>
      );
    case '/coremeasurementshub':
      return (
        <h2 className={title({color: "green"})} key={endpoint}>Core Measurements Hub</h2>
      );
    case '/fileuploadhub':
      return (
        <h3 className={title({color: "pink"})} key={endpoint}>File Upload Hub</h3>
      );
    case '/fileuploadhub/arcgisfile':
      return (
        <h3 className={title({color: "pink"})} key={endpoint}>File Upload Hub - ArcGIS Files</h3>
      );
    case '/fileuploadhub/csvfile':
      return (
        <h3 className={title({color: "pink"})} key={endpoint}>File Upload Hub - CSV Files</h3>
      );
    case '/properties':
      return (
        <h3 className={title({color: "sky"})} key={endpoint}>Properties Hub</h3>
      );
    case '/properties/attributes':
      return (
        <h3 className={title({color: "sky"})} key={endpoint}>Properties Hub - Attributes</h3>
      );
    case '/properties/census':
      return (
        <h3 className={title({color: "sky"})} key={endpoint}>Properties Hub - Census</h3>
      );
    case '/properties/personnel':
      return (
        <h3 className={title({color: "sky"})} key={endpoint}>Properties Hub - Personnel</h3>
      );
    case '/properties/quadrats':
      return (
        <h3 className={title({color: "sky"})} key={endpoint}>Properties Hub - Quadrats</h3>
      );
    case '/properties/species':
      return (
        <h3 className={title({color: "sky"})} key={endpoint}>Properties Hub - Species</h3>
      );
    default:
      return (
        <>
        </>
      );
  }
}

interface PlotData {
  key: string;
  num: number;
  id: number;
}

export default function Endpoint({children,}: Readonly<{ children: React.ReactNode }>) {
  useSession({
    required: true,
    onUnauthenticated() {
      redirect('/login');
    },
  });

  const router = useRouter();
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

  const fetchAndDispatchQuadrats = async () => {
    setLoading(loading + interval);
    setLoadingMsg('Retrieving Census...');

    // check if quadratsLoad is available in localStorage
    const quadratLoadData = JSON.parse(localStorage.getItem('quadratsLoad') ?? 'null');
    let quadratsRDSLoad: QuadratsRDS[];
    if (quadratLoadData) {
      quadratsRDSLoad = quadratLoadData;
    } else {
      const response = await fetch('/api/fixeddata/quadrats', {method: 'GET'});
      quadratsRDSLoad = await response.json();
      localStorage.setItem('quadratsLoad', JSON.stringify(quadratsRDSLoad));
    }

    if (quadratsLoadDispatch) {
      quadratsLoadDispatch({quadratsLoad: quadratsRDSLoad});
    }

    const quadratListData = JSON.parse(localStorage.getItem('quadratList') ?? 'null');
    let quadratList: Quadrat[];
    if (quadratListData) {
      quadratList = quadratListData;
    } else {
      // Generate plotList from plotRDSLoad if not in localStorage
      quadratList = quadratsRDSLoad.map((quadratRDS) => ({
        quadratID: quadratRDS.quadratID ? quadratRDS.quadratID : 0,
        plotID: quadratRDS.plotID ? quadratRDS.plotID : 0,
        quadratName: quadratRDS.quadratName ? quadratRDS.quadratName : '',
      }));
      localStorage.setItem('quadratList', JSON.stringify(quadratList));
    }

    setLoadingMsg('Dispatching Census List...');
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
    const handlePageRefresh = () => {
      console.log('Page is refreshed. Run your function here.');
      fetchDataEffect().catch(console.error);
    };

    // Check if the router is available and window is defined
    if (router && typeof window !== 'undefined') {
      window.addEventListener('beforeunload', handlePageRefresh);

      return () => {
        window.removeEventListener('beforeunload', handlePageRefresh);
      };
    }
  }, [router]);

  let pathname = usePathname();
  return (
    <>
      <Sidebar/>
      <Header/>
      <Box
        component="main"
        className="MainContent"
        sx={{
          marginTop: 'var(--Header-height)',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          gap: 1,
          flexGrow: 1,
          flexShrink: 1,
          overflow: 'hidden',
        }}
      >
        <Box sx={{
          display: 'flex',
          alignItems: 'left',
          paddingTop: '25px',
          paddingLeft: '5px',
          paddingBottom: '25px',
          flexDirection: 'column',
        }}>
          {renderSwitch(pathname)}
        </Box>
        <Divider orientation={"horizontal"} sx={{my: '5px'}}/>
        <Box
          sx={{
            display: 'flex',
            flexGrow: 1,
            flexShrink: 1,
            alignItems: 'flex-start',
            flexDirection: 'column',
            paddingLeft: 2
          }}>
          {children}
        </Box>
        <Divider orientation={"horizontal"}/>
        <Box mt={3}
             sx={{
               display: 'flex',
               alignItems: 'center',
               alignSelf: 'center',
               flexDirection: 'row',
               marginBottom: '15px'
             }}>
          <Box>
            <h1 className={title({color: "violet"})}>{siteConfig.name}&nbsp;</h1>
          </Box>
          <Divider orientation={"vertical"} sx={{marginRight: 2}}/>
          <Box>
            <p className={subtitle({color: "cyan"})}>{siteConfig.description}</p>
          </Box>
        </Box>
      </Box>
    </>
  );
}