import "@/styles/globals.css";
import {Providers} from "./providers";
import React from "react";
export default function RootLayout({ children, }: { children: React.ReactNode; }) {
  return (
    <>
      <html lang="en">
      <Providers themeProps={{attribute: "class", defaultTheme: "dark"}}>
        {children}
      </Providers>
      </html>
    </>
  );
}
