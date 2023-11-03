"use client";
import * as React from 'react';
import GlobalStyles from '@mui/joy/GlobalStyles';
import Box from '@mui/joy/Box';
import Divider from '@mui/joy/Divider';
import List from '@mui/joy/List';
import ListItem from '@mui/joy/ListItem';
import ListItemButton, {listItemButtonClasses} from '@mui/joy/ListItemButton';
import ListItemContent from '@mui/joy/ListItemContent';
import Typography from '@mui/joy/Typography';
import Sheet from '@mui/joy/Sheet';
import DashboardIcon from '@mui/icons-material/Dashboard';
import FolderIcon from '@mui/icons-material/Folder';
import DataObjectIcon from '@mui/icons-material/DataObject';
import AssignmentRoundedIcon from '@mui/icons-material/AssignmentRounded';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';

import {closeSidebar} from '@/config/utils';
import {LoginLogout} from "@/components/loginlogout";
import {useSession} from "next-auth/react";
import {PlotSelection} from "@/components/plotselection";
import Option from "@mui/joy/Option";
import Select from "@mui/joy/Select";
import { Card, CardContent } from '@mui/joy';
import {plots} from "@/config/macros";
import {usePlotContext, usePlotDispatch} from "@/app/plotcontext";
import {useEffect, useState} from "react";
import {usePathname, useRouter} from "next/navigation";

function Toggler({
                   defaultExpanded = false,
                   renderToggle,
                   children,
                 }: {
  defaultExpanded?: boolean;
  children: React.ReactNode;
  renderToggle: (params: {
    open: boolean;
    setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  }) => React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultExpanded);
  return (
    <React.Fragment>
      {renderToggle({ open, setOpen })}
      <Box
        sx={{
          display: 'grid',
          gridTemplateRows: open ? '1fr' : '0fr',
          transition: '0.2s ease',
          '& > *': {
            overflow: 'hidden',
          },
        }}
      >
        {children}
      </Box>
    </React.Fragment>
  );
}

export default function Sidebar() {
  const dispatch = usePlotDispatch();
  const [value, setValue] = useState<string>("");
  const {status} = useSession();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (dispatch) {
      dispatch({
        plotKey: value,
      });
    }
  }, [dispatch, value]);
  const keys = plots.map(plot => {
    return {
      key: plot.key
    };
  });
  if (status === "authenticated") {
    return (
      <Sheet
        className="Sidebar"
        sx={{
          position: {
            md: 'sticky',
          },
          height: '100dvh',
          width: 'var(--Sidebar-width)',
          top: 0,
          p: 2,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          borderRight: '1px solid',
          borderColor: 'divider',
        }}
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
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <Typography level="title-lg">ForestGEO</Typography>
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
          <List
            size="sm"
            sx={{
              gap: 1,
              '--List-nestedInsetStart': '30px',
              '--ListItem-radius': (theme) => theme.vars.radius.sm,
            }}
          >
            <ListItem>
              <ListItemButton selected={pathname === '/dashboard'} color={pathname === '/dashboard' ? 'primary' : undefined} onClick={() => router.push('/dashboard')}>
                <DashboardIcon />
                <ListItemContent>
                  <Typography level="title-sm">Dashboard</Typography>
                </ListItemContent>
              </ListItemButton>
            </ListItem>
            
            <ListItem>
              <ListItemButton selected={pathname === '/files'} color={pathname === '/files' ? 'primary' : undefined} onClick={() => router.push('/files')}>
                <FolderIcon />
                <ListItemContent>
                  <Typography level="title-sm">Files</Typography>
                </ListItemContent>
              </ListItemButton>
            </ListItem>
            
            <ListItem>
              <ListItemButton selected={pathname === '/data'} color={pathname === '/data' ? 'primary' : undefined} onClick={() => router.push('/data')}>
                <DataObjectIcon />
                <ListItemContent>
                  <Typography level="title-sm">Data</Typography>
                </ListItemContent>
              </ListItemButton>
            </ListItem>
            
            <ListItem nested>
              <Toggler
                renderToggle={({ open, setOpen }) => (
                  <ListItemButton onClick={() => setOpen(!open)}>
                    <AssignmentRoundedIcon />
                    <ListItemContent>
                      {value == "None" || value == "" ?
                        <Typography level="title-sm">Plots</Typography> :
                        <Typography level={"title-sm"}>Now Viewing: {value}</Typography>}
                    </ListItemContent>
                    <KeyboardArrowDownIcon
                      sx={{ transform: open ? 'rotate(180deg)' : 'none' }}
                    />
                  </ListItemButton>
                )}
              >
                <List sx={{ gap: 0.5 }}>
                  {keys.map((keyItem, keyIndex) => (
                    <ListItem key={keyIndex}>
                      <ListItemButton selected={value == keyItem.key} onClick={() => setValue(keyItem.key)}>
                        {keyItem.key}
                      </ListItemButton>
                    </ListItem>
                  ))}
                </List>
              </Toggler>
            </ListItem>
          </List>
        </Box>
        <Divider />
        <LoginLogout />
      </Sheet>
    );
  } else { // unauthenticated
    return (
      <Sheet
        className="Sidebar"
        sx={{
          position: {
            md: 'sticky',
          },
          height: '100dvh',
          width: 'var(--Sidebar-width)',
          top: 0,
          p: 2,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          borderRight: '1px solid',
          borderColor: 'divider',
        }}
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
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <Typography level="title-lg">ForestGEO</Typography>
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
          <List
            size="sm"
            sx={{
              gap: 1,
              '--List-nestedInsetStart': '30px',
              '--ListItem-radius': (theme) => theme.vars.radius.sm,
            }}
          >
            <ListItem>
              <ListItemButton>
                <DashboardIcon />
                <ListItemContent>
                  <Typography level="title-sm">Dashboard</Typography>
                </ListItemContent>
              </ListItemButton>
            </ListItem>
            
            <ListItem>
              <ListItemButton>
                <FolderIcon />
                <ListItemContent>
                  <Typography level="title-sm">Files</Typography>
                </ListItemContent>
              </ListItemButton>
            </ListItem>
            
            <ListItem>
              <ListItemButton>
                <DataObjectIcon />
                <ListItemContent>
                  <Typography level="title-sm">Data</Typography>
                </ListItemContent>
              </ListItemButton>
            </ListItem>
          </List>
        </Box>
        <Divider />
        <LoginLogout />
      </Sheet>
    );
  }
  
}
