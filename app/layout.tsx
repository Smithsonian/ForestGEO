import "@/styles/globals.css";
import {Providers} from "./providers";
import React from "react";
import {PlotsProvider} from "@/app/plotcontext";
export default function RootLayout({ children, }: { children: React.ReactNode; }) {
  return (
    <>
      <html lang="en">
      <PlotsProvider>
        <Providers themeProps={{attribute: "class", defaultTheme: "dark"}}>
          {children}
        </Providers>
      </PlotsProvider>
      </html>
    </>
  );
}
