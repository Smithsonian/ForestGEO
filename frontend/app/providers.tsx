"use client";
import * as React from "react";
import {SessionProvider} from "next-auth/react";
import ThemeRegistry from "@/components/themeregistry/themeregistry";
import {LocalizationProvider} from "@mui/x-date-pickers";
import {AdapterMoment} from '@mui/x-date-pickers/AdapterMoment'

export interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({children}: Readonly<ProvidersProps>) {
  return (
    <ThemeRegistry>
      <SessionProvider>
        <LocalizationProvider dateAdapter={AdapterMoment}>
          {children}
        </LocalizationProvider>
      </SessionProvider>
    </ThemeRegistry>
  );
}
