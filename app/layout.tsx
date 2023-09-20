import "@/styles/globals.css";
import {Providers} from "./providers";
import React from "react";
import {PlotsProvider} from "@/app/plotcontext";
export default function RootLayout({ children, }: { children: React.ReactNode; }) {
  return (
    <>
      <html lang="en">
      <head>
        <title>ForestGEO Data Entry</title>
      </head>
      <PlotsProvider>
        <Providers themeProps={{attribute: "class", defaultTheme: "dark"}}>
          {children}
        </Providers>
      </PlotsProvider>
      </html>
    </>
  );
}
