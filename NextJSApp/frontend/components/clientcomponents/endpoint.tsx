"use client";
import {useAttributeLoadDispatch} from "@/app/plotcontext";
import * as React from "react";
import {useEffect} from "react";
import {useSession} from "next-auth/react";
import {redirect, usePathname} from "next/navigation";
import {subtitle, title} from "@/config/primitives";
import Sidebar from "@/components/sidebar";
import Header from "@/components/header";
import {Box} from "@mui/joy";
import Divider from "@mui/joy/Divider";
import {siteConfig} from "@/config/macros";
import {GridRowProps, GridValidRowModel} from "@mui/x-data-grid";

export default function Endpoint({children,}: { children: React.ReactNode }) {
  const attributeDispatch = useAttributeLoadDispatch();
  useEffect(() => {
    const fetchAttributes = async () => {
      const response = await fetch(`/api/attributes`, {method: 'GET'});
      const converted: GridValidRowModel[] = await response.json();
      if (attributeDispatch) {
        attributeDispatch({attributeLoad: converted});
      }
    }
    fetchAttributes().catch(console.error);
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
      case 'data':
        return (
          <>
            <h2 className={title({color: "green"})} key={endpoint}>Data Hub</h2>
          </>
        )
      case 'files':
        return (
          <>
            <h3 className={title({color: "pink"})} key={endpoint}>File Hub</h3>
          </>
        )
      case 'properties':
        return (
          <>
            <h3 className={title({color: "sky"})} key={endpoint}>Properties Hub</h3>
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
          paddingLeft: '25px',
          paddingBottom: '25px',
          flexDirection: 'column',
        }}>
          {renderSwitch(pathname.split('/')[1])}
        </Box>
        <Divider orientation={"horizontal"} sx={{my: '5px'}} />
        <Box sx={{display: 'flex', flexGrow: 1, flexShrink: 1, alignItems: 'flex-start', flexDirection: 'column', paddingLeft: 10}}>
          {children}
        </Box>
        <Divider orientation={"horizontal"} />
        <Box mt={3} sx={{display: 'flex', alignItems: 'center', alignSelf: 'center', flexDirection: 'row', marginBottom: '15px'}}>
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