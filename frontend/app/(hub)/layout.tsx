import Endpoint from "@/components/client/endpoint";
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