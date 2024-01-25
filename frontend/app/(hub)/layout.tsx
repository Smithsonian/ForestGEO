import Endpoint from "@/components/client/endpoint";
import React from "react";


export default function HubLayout({children,}: Readonly<{ children: React.ReactNode }>) {

  return (
    <Endpoint>
      {children}
    </Endpoint>
  );
}