"use client";
import * as React from "react";
import { SessionProvider } from "next-auth/react";
import ThemeRegistry from "@/components/themeregistry/themeregistry";
import { LocalizationProvider } from "@mui/x-date-pickers";
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { JoyrideProvider } from "./contexts/joyrideprovider";

export interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({ children }: Readonly<ProvidersProps>) {
  return (
    <ThemeRegistry>
      <SessionProvider>
        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <JoyrideProvider>
            {children}
          </JoyrideProvider>
        </LocalizationProvider>
      </SessionProvider>
    </ThemeRegistry>
  );
}
