'use client';
import * as React from 'react';
import { useState, useEffect } from 'react';
import GlobalStyles from '@mui/joy/GlobalStyles';
import Sheet from '@mui/joy/Sheet';
import IconButton from '@mui/joy/IconButton';
import MenuIcon from '@mui/icons-material/Menu';
import { toggleSidebar } from '@/config/utils';

export default function Header() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Check initial sidebar state on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      const slideIn = window.getComputedStyle(document.documentElement).getPropertyValue('--SideNavigation-slideIn');
      setIsSidebarOpen(!!slideIn);
    }
  }, []);

  const handleToggleSidebar = () => {
    try {
      toggleSidebar();
      // Toggle state after successful toggle
      setIsSidebarOpen(prev => !prev);
    } catch (error) {
      // Log error but don't crash the component
      console.error('Failed to toggle sidebar:', error);
      // Optionally, you could show a user-facing error message here
    }
  };

  return (
    <Sheet
      role="banner"
      sx={{
        display: { xs: 'flex', md: 'none' },
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'fixed',
        top: 0,
        width: '100vw',
        height: 'var(--Header-height)',
        zIndex: 9995,
        p: 2,
        gap: 1,
        borderBottom: '1px solid',
        borderColor: 'background.level1',
        boxShadow: 'sm'
      }}
    >
      <GlobalStyles
        styles={theme => ({
          ':root': {
            '--Header-height': '52px',
            [theme.breakpoints.up('md')]: {
              '--Header-height': '0px'
            }
          }
        })}
      />
      <IconButton
        onClick={handleToggleSidebar}
        variant="outlined"
        color="neutral"
        size="sm"
        aria-label="Menu"
        aria-expanded={isSidebarOpen}
        aria-controls="side-navigation"
      >
        <MenuIcon />
      </IconButton>
    </Sheet>
  );
}
