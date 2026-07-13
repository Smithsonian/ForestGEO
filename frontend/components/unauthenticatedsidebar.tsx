'use client';
import { Box } from '@mui/joy';
import React from 'react';
import { LoginLogout } from '@/components/loginlogout';

/**
 * UNAUTHENTICATED SESSION HANDLING:
 * Rendered inside the login page's centered card, so it only provides the
 * authentication controls — the card owns the branding and layout.
 */
export default function UnauthenticatedSidebar() {
  return (
    <Box data-testid="sidebar" role="region" aria-label="Authentication controls" sx={{ width: '100%' }}>
      <LoginLogout data-testid="login-logout" />
    </Box>
  );
}
