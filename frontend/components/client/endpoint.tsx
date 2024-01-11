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
import {siteConfig} from "@/config/macros";
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
import {usePlotListDispatch} from "@/app/contexts/generalcontext";
import {PlotRDS} from "@/config/sqlmacros";

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
    const response = await fetch('/api/fixeddata/plots', {method: 'GET'});
    setLoading(loading + interval);
    setLoadingMsg('Dispatching...');
    const plotRDSLoad: PlotRDS[] = await response.json();
    if (plotsLoadDispatch) {
      plotsLoadDispatch({plotsLoad: plotRDSLoad});
      localStorage.setItem("plotsLoad", JSON.stringify(plotRDSLoad));
    }

    const plotList: PlotData[] = plotRDSLoad.map((plotRDS) => ({
      key: plotRDS.plotName ? plotRDS.plotName : '',
      num: quadratsLoadDispatch ? quadratsLoadDispatch.length : 0,
      id: plotRDS.plotID,
    }));

    setLoadingMsg('Dispatching Plot List...');
    if (plotsListDispatch) {
      plotsListDispatch({plotList: plotList});
      localStorage.setItem("plotList", JSON.stringify(plotList));
    }
  };

  useEffect(() => {
    const fetchDataEffect = async () => {
      try {
        const coreMeasurementLoadData = JSON.parse(localStorage.getItem('coreMeasurementLoad') ?? 'null');
        (coreMeasurementLoadData && coreMeasurementLoadDispatch) ?
          coreMeasurementLoadDispatch({coreMeasurementLoad: coreMeasurementLoadData}) : await fetchData('/api/coremeasurements', coreMeasurementLoadDispatch, 'coreMeasurementLoad');
        const attributeLoadData = JSON.parse(localStorage.getItem('attributeLoad') ?? 'null');
        (attributeLoadData && attributeLoadDispatch) ?
          attributeLoadDispatch({attributeLoad: attributeLoadData}) : await fetchData('/api/fixeddata/attributes', attributeLoadDispatch, 'attributeLoad');
        const censusLoadData = JSON.parse(localStorage.getItem('censusLoad') ?? 'null');
        (censusLoadData && censusLoadDispatch) ?
          censusLoadDispatch({censusLoad: censusLoadData}) : await fetchData('/api/fixeddata/census', censusLoadDispatch, 'censusLoad');
        const personnelLoadData = JSON.parse(localStorage.getItem('personnelLoad') ?? 'null');
        (personnelLoadData && personnelLoadDispatch) ?
          personnelLoadDispatch({personnelLoad: personnelLoadData}) : await fetchData('/api/fixeddata/personnel', personnelLoadDispatch, 'personnelLoad');
        const quadratsLoadData = JSON.parse(localStorage.getItem('quadratsLoad') ?? 'null');
        (quadratsLoadData && quadratsLoadDispatch) ?
          quadratsLoadDispatch({quadratsLoad: quadratsLoadData}) : await fetchData('/api/fixeddata/quadrats', quadratsLoadDispatch, 'quadratsLoad');
        const speciesLoadData = JSON.parse(localStorage.getItem('speciesLoad') ?? 'null');
        (speciesLoadData && speciesLoadDispatch) ?
          speciesLoadDispatch({speciesLoad: speciesLoadData}) : await fetchData('/api/fixeddata/species', speciesLoadDispatch, 'speciesLoad');
        const subSpeciesLoadData = JSON.parse(localStorage.getItem('subSpeciesLoad') ?? 'null');
        (subSpeciesLoadData && subSpeciesLoadDispatch) ?
          subSpeciesLoadDispatch({subSpeciesLoad: subSpeciesLoadData}) : await fetchData('/api/fixeddata/subspecies', subSpeciesLoadDispatch, 'subSpeciesLoad');
        await fetchAndDispatchPlots();
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