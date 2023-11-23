"use server"
import * as React from "react";
import {subtitle, title} from "@/config/primitives";
import {redirect, usePathname} from "next/navigation";
import {useSession} from "next-auth/react";
import {Box} from "@mui/joy";
import Sidebar from "@/components/sidebar";
import Divider from "@mui/joy/Divider";
import Header from "@/components/header";
import {useCensusContext, usePlotContext, useQuadratContext} from "@/app/plotcontext";
import {siteConfig} from "@/config/macros";

export default function EndpointLayout({children,}: { children: React.ReactNode }) {
  useSession({
    required: true,
    onUnauthenticated() {
      redirect('/login');
    },
  });
  
  function renderSwitch(endpoint: string) {
    switch (endpoint) {
      case '/dashboard':
        return (
          <>
            <h3 className={title({color: "cyan"})} key={endpoint}>Dashboard View</h3>
          </>
        )
      case '/data':
        return (
          <>
            <h2 className={title({color: "green"})} key={endpoint}>Data Hub</h2>
          </>
        )
      case '/files':
        return (
          <>
            <h3 className={title({color: "pink"})} key={endpoint}>File Hub</h3>
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
  const currentPlot = usePlotContext();
  const currentCensus = useCensusContext();
  const currentQuadrat = useQuadratContext();
  return (
    <>
      {/*<Stack direction={"row"}>*/}
      {/*</Stack>*/}
      <Sidebar/>
      <Header/>
      <Box
        component="main"
        className="MainContent"
        sx={{
          marginLeft: '25px',
          marginTop: 'var(--Header-height)',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          gap: 1,
          flexGrow: 1,
          flexShrink: 1,
        }}
      >
        <Box sx={{
          display: 'flex',
          alignItems: 'left',
          paddingTop: '25px',
          paddingBottom: '25px',
          flexDirection: 'column'
        }}>
          {renderSwitch(pathname)}
        </Box>
        <Box sx={{display: 'flex', flexGrow: 1, flexShrink: 1, alignItems: 'flex-start', flexDirection: 'column'}}>
          {children}
        </Box>
        <Box mt={3} position="absolute" bottom="25px" right="calc(40% - var(--Sidebar-width))"
             sx={{display: 'flex', alignItems: 'center', flexDirection: 'row'}}>
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