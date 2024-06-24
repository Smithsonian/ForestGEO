"use client";
import React, { useEffect, useCallback, useRef, useState } from "react";
import { subtitle, title } from "@/config/primitives";
import { useSession } from "next-auth/react";
import { redirect, usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { Box } from "@mui/joy";
import Divider from "@mui/joy/Divider";
import { useLoading } from "@/app/contexts/loadingprovider";
import { getAllSchemas } from "@/components/processors/processorhelperfunctions";
import {
  useSiteContext,
  usePlotContext,
  useOrgCensusContext,
  useQuadratContext,
} from "@/app/contexts/userselectionprovider";
import {
  useOrgCensusListContext,
  useOrgCensusListDispatch,
  usePlotListContext,
  usePlotListDispatch,
  useQuadratListContext,
  useQuadratListDispatch,
  useSiteListDispatch,
  useSubquadratListContext,
  useSubquadratListDispatch,
} from "@/app/contexts/listselectionprovider";
import {createAndUpdateCensusList} from "@/config/sqlrdsdefinitions/orgcensusrds";
import {siteConfig} from "@/config/macros/siteconfigs";
import { useDataValidityContext } from "../contexts/datavalidityprovider";

const Sidebar = dynamic(() => import('@/components/sidebar'), { ssr: false });
const Header = dynamic(() => import('@/components/header'), { ssr: false });

function renderSwitch(endpoint: string) {
  switch (endpoint) {
    case '/dashboard':
      return <Box><h3 className={title({ color: "cyan" })} key={endpoint}>Dashboard - ForestGEO Application User
        Guide</h3></Box>;
    case '/measurementshub/summary':
      return <Box><h3 className={title({ color: "green" })} key={endpoint}>Measurements Summary</h3></Box>;
    case '/measurementshub/validationhistory':
      return <Box><h3 className={title({ color: "green" })} key={endpoint}>Validation History</h3></Box>;
    case '/fixeddatainput/attributes':
      return <Box><h3 className={title({ color: "sky" })} key={endpoint}>Supporting Data Hub - Attributes</h3></Box>;
    case '/fixeddatainput/census':
      return <Box><h3 className={title({ color: "sky" })} key={endpoint}>Supporting Data - Census</h3></Box>;
    case '/fixeddatainput/personnel':
      return <Box><h3 className={title({ color: "sky" })} key={endpoint}>Supporting Data - Personnel</h3></Box>;
    case '/fixeddatainput/quadrats':
      return <Box><h3 className={title({ color: "sky" })} key={endpoint}>Supporting Data - Quadrats</h3></Box>;
    case '/fixeddatainput/subquadrats':
      return <Box><h3 className={title({ color: "sky" })} key={endpoint}>Supporting Data - Subquadrats</h3></Box>;
    case '/fixeddatainput/quadratpersonnel':
      return <Box><h3 className={title({ color: "sky" })} key={endpoint}>Supporting Data - QuadratPersonnel</h3></Box>;
    case '/fixeddatainput/alltaxonomies':
      return <Box><h3 className={title({ color: "sky" })} key={endpoint}>Supporting Data - All Taxonomies</h3></Box>;
    default:
      return <></>;
  }
}

export default function HubLayout({ children }: { children: React.ReactNode }) {
  const { setLoading } = useLoading();

  const censusListDispatch = useOrgCensusListDispatch();
  const quadratListDispatch = useQuadratListDispatch();
  const siteListDispatch = useSiteListDispatch();
  const subquadratListDispatch = useSubquadratListDispatch();
  const plotListDispatch = usePlotListDispatch();

  const censusListContext = useOrgCensusListContext();
  const quadratListContext = useQuadratListContext();
  const subquadratListContext = useSubquadratListContext();
  const plotListContext = usePlotListContext();

  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const currentQuadrat = useQuadratContext();
  const { data: session } = useSession();
  const {validity} = useDataValidityContext();
  const previousSiteRef = useRef<string | undefined>(undefined);

  const [siteListLoaded, setSiteListLoaded] = useState(false);
  const [plotListLoaded, setPlotListLoaded] = useState(false);
  const [censusListLoaded, setCensusListLoaded] = useState(false);
  const [quadratListLoaded, setQuadratListLoaded] = useState(false);
  const [subquadratListLoaded, setSubquadratListLoaded] = useState(false);
  const [manualReset, setManualReset] = useState(false);
  const [isSidebarVisible, setSidebarVisible] = useState(!!session);

  const pathname = usePathname();

  const coreDataLoaded = siteListLoaded && plotListLoaded && censusListLoaded && (quadratListLoaded || subquadratListLoaded);

  const loadCensusData = useCallback(async () => {
    if (!currentPlot) return { success: false, message: 'Plot must be selected to load census data' };
    if (censusListContext !== undefined && censusListContext.length > 0) return { success: true };

    setLoading(true, 'Loading raw census data');
    const response = await fetch(`/api/fetchall/census/${currentPlot.plotID}?schema=${currentSite?.schemaName || ''}`);
    const censusRDSLoad = await response.json();
    setLoading(false);

    setLoading(true, 'Converting raw census data...');
    const censusList = await createAndUpdateCensusList(censusRDSLoad);
    if (censusListDispatch) {
      censusListDispatch({ censusList });
    }
    setLoading(false);
    setCensusListLoaded(true);
    return { success: true };
  }, [censusListContext, censusListDispatch, currentPlot, currentSite, setLoading, validity]);

  const loadPlotsData = useCallback(async () => {
    if (!currentSite) return { success: false, message: 'Site must be selected to load plot data' };
    if (plotListContext !== undefined && plotListContext.length > 0) return { success: true };

    setLoading(true, "Loading plot list information...");
    const plotsResponse = await fetch(`/api/fetchall/plots?schema=${currentSite?.schemaName || ''}`);
    const plotsData = await plotsResponse.json();
    if (!plotsData) return { success: false, message: 'Failed to load plots data' };
    setLoading(false);

    setLoading(true, "Dispatching plot list information...");
    if (plotListDispatch) {
      await plotListDispatch({ plotList: plotsData });
    } else return { success: false, message: 'Failed to dispatch plots data' };
    setLoading(false);
    setPlotListLoaded(true);
    return { success: true };
  }, [plotListContext, plotListDispatch, currentSite, setLoading, validity]);

  const loadQuadratsData = useCallback(async () => {
    if (!currentPlot || !currentCensus) return {
      success: false,
      message: 'Plot and Census must be selected to load quadrat data'
    };
    if (quadratListContext !== undefined && quadratListContext.length > 0) return { success: true };

    setLoading(true, "Loading quadrat list information...");
    const quadratsResponse = await fetch(`/api/fetchall/quadrats/${currentPlot.plotID}/${currentCensus.plotCensusNumber}?schema=${currentSite?.schemaName || ''}`);
    const quadratsData = await quadratsResponse.json();
    if (!quadratsData) return { success: false, message: 'Failed to load quadrats data' };
    setLoading(false);

    setLoading(true, "Dispatching quadrat list information...");
    if (quadratListDispatch) {
      await quadratListDispatch({ quadratList: quadratsData });
    } else return { success: false, message: 'Failed to dispatch quadrats data' };
    setLoading(false);
    setQuadratListLoaded(true);
    return { success: true };
  }, [quadratListContext, quadratListDispatch, currentPlot, currentCensus, currentSite, setLoading, validity]);

  const loadSubquadratsData = useCallback(async () => {
    if (!currentPlot || !currentCensus || !currentQuadrat) return {
      success: false,
      message: 'Plot, Census, and Quadrat must be selected to load subquadrat data'
    };
    if (subquadratListContext !== undefined && subquadratListContext.length > 0) return { success: true };

    setLoading(true, "Loading subquadrat list information...");
    const subquadratResponse = await fetch(`/api/fetchall/subquadrats/${currentPlot.plotID}/${currentCensus.plotCensusNumber}/${currentQuadrat.quadratID}?schema=${currentSite?.schemaName || ''}`);
    const subquadratData = await subquadratResponse.json();
    if (!subquadratData) return { success: false, message: 'Failed to load subquadrats data' };
    setLoading(false);

    setLoading(true, "Dispatching subquadrat list information...");
    if (subquadratListDispatch) {
      await subquadratListDispatch({ subquadratList: subquadratData });
    } else return { success: false, message: 'Failed to dispatch subquadrat list' };
    setLoading(false);
    setSubquadratListLoaded(true);
    return { success: true };
  }, [subquadratListContext, subquadratListDispatch, currentPlot, currentCensus, currentQuadrat, currentSite, setLoading, validity]);

  const fetchSiteList = useCallback(async () => {
    setLoading(true, 'Loading Sites...');
    try {
      if (session && !siteListLoaded) {
        const sites = session?.user?.allsites ?? [];
        if (sites.length === 0) {
          throw new Error("Session sites undefined");
        } else {
          siteListDispatch ? await siteListDispatch({siteList: sites}) : undefined;
        }
      }
    } catch (e: any) {
      const allsites = await getAllSchemas();
      siteListDispatch ? await siteListDispatch({siteList: allsites}) : undefined;
    }
    setLoading(false);
  }, [session, siteListLoaded, siteListDispatch, setLoading, validity]);

  useEffect(() => {
    if (session && !siteListLoaded) {
      fetchSiteList()
        .then(() => setSiteListLoaded(true))
        .catch(console.error);
    }
  }, [fetchSiteList, session, siteListLoaded]);

  useEffect(() => {
    if (!plotListLoaded && plotListDispatch) {
      plotListDispatch({ plotList: undefined }).catch(console.error);
    }
    if (!censusListLoaded && censusListDispatch) {
      censusListDispatch({ censusList: undefined }).catch(console.error);
    }
    if (!quadratListLoaded && quadratListDispatch) {
      quadratListDispatch({ quadratList: undefined }).catch(console.error);
    }
    if (!subquadratListLoaded && subquadratListDispatch) {
      subquadratListDispatch({ subquadratList: undefined }).catch(console.error);
    }
  }, [plotListLoaded, censusListLoaded, quadratListLoaded, subquadratListLoaded]);

  useEffect(() => {
    const hasSiteChanged = previousSiteRef.current !== currentSite?.siteName;
    if (siteListLoaded && currentSite && hasSiteChanged) {
      setPlotListLoaded(false);
      setCensusListLoaded(false);
      setQuadratListLoaded(false);
      setSubquadratListLoaded(false);
      previousSiteRef.current = currentSite.siteName;
    }
    if (siteListLoaded && currentSite && !plotListLoaded) {
      loadPlotsData().catch(console.error);
    }
    if (siteListLoaded && currentSite && plotListLoaded && !censusListLoaded) {
      loadCensusData().catch(console.error);
    }
    if (siteListLoaded && currentSite && plotListLoaded && censusListLoaded && !quadratListLoaded) {
      loadQuadratsData().catch(console.error);
    }
    // if (siteListLoaded && currentSite && plotListLoaded && censusListLoaded && quadratListLoaded && !subquadratListLoaded) {
    //   loadSubquadratsData().catch(console.error);
    // }
  }, [siteListLoaded, currentSite, plotListLoaded, censusListLoaded, quadratListLoaded, subquadratListLoaded, loadCensusData, loadPlotsData, loadQuadratsData, loadSubquadratsData]);

  useEffect(() => {
    if (manualReset) {
      setLoading(true, "Manual refresh beginning...");
      setPlotListLoaded(false);
      setCensusListLoaded(false);
      setQuadratListLoaded(false);
      setSubquadratListLoaded(false);
      setSiteListLoaded(false);
      setManualReset(false);
      setLoading(false);
    }
  }, [manualReset]);

  useEffect(() => {
    // if contexts are reset due to website refresh, system needs to redirect user back to dashboard
    if ((currentSite === undefined && currentPlot === undefined && currentQuadrat === undefined) && pathname !== '/dashboard') redirect('/dashboard');
  }, [pathname]);

  useEffect(() => {
    if (session) {
      const timer = setTimeout(() => {
        setSidebarVisible(true);
      }, 300); // Debounce the sidebar visibility with a delay
      return () => clearTimeout(timer);
    }
  }, [session]);

  return (
    <>
      <Box
        className={`sidebar ${isSidebarVisible ? 'visible' : 'hidden'}`}
        sx={{ position: 'fixed', top: 0, left: 0, height: '100vh', zIndex: 1000 }}
      >
        <Sidebar
          setCensusListLoaded={setCensusListLoaded}
          siteListLoaded={siteListLoaded}
          coreDataLoaded={coreDataLoaded}
          setManualReset={setManualReset}
        />
      </Box>
      <Header />
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
          minHeight: 'calc(100vh - var(--Header-height) - 30px)',
          marginLeft: isSidebarVisible ? 'calc(var(--Sidebar-width) + 5px)' : '0',
          transition: 'margin-left 0.3s ease-in-out',
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
          {renderSwitch(usePathname())}
        </Box>
        <Divider orientation={"horizontal"} sx={{ my: '5px' }} />
        <Box
          sx={{
            display: 'flex',
            flexGrow: 1,
            flexShrink: 1,
            alignItems: 'flex-start',
            flexDirection: 'column',
            paddingLeft: 2,
          }}>
          {coreDataLoaded && (
            <>
              {children}
            </>
          )}
        </Box>
        <Divider orientation={"horizontal"} />
        <Box mt={1}
          sx={{
            display: 'flex',
            alignItems: 'center',
            alignSelf: 'center',
            flexDirection: 'row',
            position: 'relative',
            left: 'calc(-1 * var(--Sidebar-width) / 2)',
            transition: 'top 0.3s ease-in-out', // Transition for vertical movement only
          }}>
          <Box>
            <h1 className={title({ color: "violet" })}>{siteConfig.name}&nbsp;</h1>
          </Box>
          <Divider orientation={"vertical"} sx={{ marginRight: 2 }} />
          <Box>
            <p className={subtitle({ color: "cyan" })}>{siteConfig.description}</p>
          </Box>
        </Box>
      </Box>
    </>
  );
}
