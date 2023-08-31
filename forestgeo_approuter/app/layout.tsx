import "@/styles/globals.css";
import {fontSans} from "@/config/fonts";
import {Providers} from "./providers";
import clsx from "clsx";
import React from "react";


export default function RootLayout({
                                     children,
                                   }: {
  children: React.ReactNode;
}) {
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
