"use client";
import * as React from "react";
import {useEffect, useState} from "react";
import {useSession} from "next-auth/react";
import {redirect, usePathname} from "next/navigation";
import {subtitle, title} from "@/config/primitives";
import Sidebar from "@/components/sidebar";
import Header from "@/components/header";
import {
  Box,
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
import Divider from "@mui/joy/Divider";
import {siteConfig} from "@/config/macros";
import {
  useAttributeLoadDispatch,
  useCensusLoadDispatch,
  usePersonnelLoadDispatch,
  usePlotsLoadDispatch,
  useQuadratsLoadDispatch,
  useSpeciesLoadDispatch
} from "@/app/contexts/fixeddatacontext";
import {useFirstLoadContext, useFirstLoadDispatch} from "@/app/contexts/plotcontext";
import WarningRoundedIcon from "@mui/icons-material/WarningRounded";

export default function Endpoint({children,}: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(0);
  const [loadingMsg, setLoadingMsg] = useState('');
  const attributeLoadDispatch = useAttributeLoadDispatch();
  const censusLoadDispatch = useCensusLoadDispatch();
  const personnelLoadDispatch = usePersonnelLoadDispatch();
  const quadratsLoadDispatch = useQuadratsLoadDispatch();
  const speciesLoadDispatch = useSpeciesLoadDispatch();
  const plotsLoadDispatch = usePlotsLoadDispatch();
  useEffect(() => {
    const fetchData = async () => {
      setLoading(0);
      setLoadingMsg('Retrieving Attributes...');
      let response = await fetch(`/api/fixeddata/attributes`, {method: 'GET'});
      setLoading(9);
      if (attributeLoadDispatch) {
        attributeLoadDispatch({attributeLoad: await response.json()});
      }
      setLoading(18);
      setLoadingMsg('Retrieving Census...');
      response = await fetch(`/api/fixeddata/census`, {method: 'GET'});
      setLoading(27);
      if (censusLoadDispatch) {
        censusLoadDispatch({censusLoad: await response.json()});
      }
      setLoading(36);
      setLoadingMsg('Retrieving Personnel...');
      await new Promise(f => setTimeout(f, 1000));
      // response = await fetch(`/api/fixeddata/personnel`, {method: 'GET'});
      setLoading(45);
      // if(personnelLoadDispatch){
      //   personnelLoadDispatch({personnelLoad: await response.json()});
      // }
      setLoading(54);
      setLoadingMsg('Retrieving Quadrats...');
      await new Promise(f => setTimeout(f, 1000));
      // response = await fetch(`/api/fixeddata/quadrats`, {method: 'GET'});
      setLoading(63);
      // if (quadratsLoadDispatch) {
      //   quadratsLoadDispatch({quadratsLoad: await response.json()});
      // }
      setLoading(72);
      setLoadingMsg('Retrieving Species...');
      await new Promise(f => setTimeout(f, 1000));
      // response = await fetch(`/api/fixeddata/species`, {method: 'GET'});
      setLoading(81);
      // if (speciesLoadDispatch) {
      //   speciesLoadDispatch({speciesLoad: await response.json()});
      // }
      setLoading(90)
      setLoadingMsg('Retrieving Plots...')
      response = await fetch(`/api/fixeddata/plots`, {method: 'GET'});
      setLoading(99);
      if (plotsLoadDispatch) {
        plotsLoadDispatch({plotsLoad: await response.json()});
      }
      setLoading(100);
    }
    fetchData().catch(console.error);
  }, []);
  useSession({
    required: true,
    onUnauthenticated() {
      redirect('/login');
    },
  });
  
  function renderSwitch(endpoint: string) {
    switch (endpoint) {
      case 'dashboard':
        return (
          <>
            <h3 className={title({color: "cyan"})} key={endpoint}>Dashboard View</h3>
          </>
        )
      case 'coremeasurementshub':
        return (
          <>
            <h2 className={title({color: "green"})} key={endpoint}>Core Measurements Hub</h2>
          </>
        )
      case 'fileuploadhub':
        return (
          <>
            <h3 className={title({color: "pink"})} key={endpoint}>CSV & ArcGIS File Upload Hub</h3>
          </>
        )
      case 'properties':
        return (
          <>
            <h3 className={title({color: "sky"})} key={endpoint}>Measurement Properties Hub</h3>
          </>
        )
      default:
        return (
          <>
          </>
        );
    }
  }
  
  let pathname = usePathname();
  const firstLoad = useFirstLoadContext();
  const firstLoadDispatch = useFirstLoadDispatch();
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
          {renderSwitch(pathname.split('/')[1])}
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
                      <Typography level={"body-sm"} >Select <b>Core Measurements Hub</b> to view existing core measurement data for a given plot, census, and quadrat</Typography>
                      <Typography level={"body-sm"}>Select <b>CSV & ArcGIS File Upload Hub</b> to upload core measurements in either CSV format or in collected ArcGIS format</Typography>
                      <Typography level={"body-sm"}>Select <b>Measurement Properties Hub</b> to view and edit measurement properties used in data collection</Typography>
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
          </Modal> : children}
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