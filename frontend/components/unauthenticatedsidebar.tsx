"use client";
import {Box, Stack} from "@mui/joy";
import GlobalStyles from "@mui/joy/GlobalStyles";
import React from "react";
import {listItemButtonClasses} from "@mui/joy/ListItemButton";
import Divider from "@mui/joy/Divider";
import {LoginLogout} from "@/components/loginlogout";
import Typography from "@mui/joy/Typography";

export default function UnauthenticatedSidebar() {
  const containerRef = React.useRef<HTMLElement>(null);
  /**
   * UNAUTHENTICATED SESSION HANDLING:
   */
  return (
    <Stack direction={"row"} overflow={'hidden'} sx={{display: 'flex', width: 'fit-content'}}>
      <Box
        className="Sidebar"
        data-testid="sidebar"
        sx={{
          position: {
            md: 'sticky',
          },
          height: '100dvh',
          width: 'calc(var(--Sidebar-width) )',
          top: 0,
          p: 2,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          borderRight: '1px solid',
          borderColor: 'divider',
        }}
        ref={containerRef}
      >
        <GlobalStyles
          styles={(theme) => ({
            ':root': {
              '--Sidebar-width': '300px',
              [theme.breakpoints.up('lg')]: {
                '--Sidebar-width': '320px',
              },
            },
          })}
        />
        <Box sx={{display: 'flex', gap: 1, alignItems: 'center'}}>
          <Typography level="h1">ForestGEO</Typography>
        </Box>
        <Box
          sx={{
            minHeight: 0,
            overflow: 'hidden auto',
            flexGrow: 1,
            display: 'flex',
            flexDirection: 'column',
            [`& .${listItemButtonClasses.root}`]: {
              gap: 1.5,
            },
          }}
        >
        </Box>
        <Divider/>
        <LoginLogout data-testid="login-logout"/>
      </Box>
    </Stack>
  );
}