import Endpoint from "@/components/clientcomponents/endpoint";
import React from "react";

export default function EndpointLayout({children,}: { children: React.ReactNode }) {
  return (
    <>
      <Endpoint>
        {children}
      </Endpoint>
    </>
  );
}