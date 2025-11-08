/**
 * Sidebar Container Component
 *
 * Simplified container for the sidebar with automatic width management using CSS
 * Replaces complex ResizeObserver logic with CSS-based sizing
 */

'use client';

import { Box } from '@mui/joy';
import { PropsWithChildren } from 'react';
import { designTokens } from '@/config/design-tokens';

export default function SidebarContainer({ children }: PropsWithChildren) {
  return (
    <Box
      component="nav"
      aria-label="Main navigation"
      className="sidebar"
      sx={{
        position: 'fixed',
        top: 0,
        left: 0,
        height: '100vh',
        minWidth: designTokens.sizes.sidebarMin,
        maxWidth: designTokens.sizes.sidebarMax,
        width: 'fit-content',
        overflowY: 'auto',
        overflowX: 'hidden',
        backgroundColor: 'background.surface',
        borderRight: '1px solid',
        borderColor: 'divider',
        zIndex: designTokens.zIndex.sidebar,
        p: 2,

        // Smooth scrolling
        scrollBehavior: 'smooth',

        // Custom scrollbar styling
        '&::-webkit-scrollbar': {
          width: '8px'
        },
        '&::-webkit-scrollbar-track': {
          backgroundColor: 'transparent'
        },
        '&::-webkit-scrollbar-thumb': {
          backgroundColor: 'neutral.400',
          borderRadius: designTokens.radius.sm,
          '&:hover': {
            backgroundColor: 'neutral.500'
          }
        },

        // Responsive behavior
        '@media (max-width: 960px)': {
          transform: 'translateX(-100%)',
          transition: `transform ${designTokens.transitions.normal} ${designTokens.transitions.easing}`,
          '&.sidebar-open': {
            transform: 'translateX(0)'
          }
        }
      }}
    >
      {children}
    </Box>
  );
}
