import "@/styles/globals.css";
import {Providers} from "./providers";
import React from "react";
import sql from "mssql";

export async function getSqlConnection() {
  let conn = await sql.connect(process.env.AZURE_SQL_ADO_CONNECTION_STRING!);
  if (conn) {
    console.log('conn works');
  } else {
    console.log('conn fucked it');
  }
}

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
