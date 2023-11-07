"use client";
import * as React from "react";
import {subtitle, title} from "@/config/primitives";
import {redirect, usePathname} from "next/navigation";
import {useSession} from "next-auth/react";
import {Box} from "@mui/joy";
import Sidebar from "@/components/sidebar";
import Divider from "@mui/joy/Divider";

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
  return (
    <>
      <Sidebar/>
      <Box
        component="main"
        className="MainContent"
        sx={{
          px: {
            xs: 2,
            md: 6,
          },
          pt: {
            xs: 'calc(12px + var(--Header-height))',
            sm: 'calc(12px + var(--Header-height))',
            md: 3,
          },
          pb: {
            xs: 2,
            sm: 2,
            md: 3,
          },
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          height: '100dvh',
          gap: 1,
        }}
      >
        <Box sx={{display: 'flex', alignItems: 'center'}}>
          {renderSwitch(pathname)}
        </Box>
        <Box sx={{display: 'flex', alignItems: 'center'}}>
          {children}
          <Box mt={3} position="absolute" bottom="10px" right="calc(40% - var(--Sidebar-width))"
               sx={{display: 'flex', alignItems: 'center', flexDirection: 'row'}}>
            <Box>
              <h1 className={title({color: "violet"})}>ForestGEO&nbsp;</h1>
            </Box>
            <Divider orientation={"vertical"} sx={{marginRight: 2}}/>
            <Box>
              <p className={subtitle({color: "cyan"})}>A data entry and validation system for your convenience.</p>
            </Box>
          </Box>
        </Box>
      </Box>
    </>
  );
}