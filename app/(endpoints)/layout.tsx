"use client";
import {Navbar} from "@/components/navbar";
import * as React from "react";
import {subtitle, title} from "@/components/primitives";
import {Divider} from "@nextui-org/react";
import {redirect, usePathname} from "next/navigation";
import {useSession} from "next-auth/react";

export default function EndpointLayout({ children, }: { children: React.ReactNode }){
  useSession({
    required: true,
    onUnauthenticated() {
      redirect('/login');
    },
  });
  function renderSwitch(endpoint: string) {
    switch (endpoint) {
      case '/dashboard':
        return (
          <>
            <h3 className={title({color: "cyan"})} key={endpoint}>Dashboard View</h3>
          </>
        )
      case '/data':
        return (
          <>
            <h2 className={title({color: "green"})} key={endpoint}>Data Hub</h2>
          </>
        )
      case '/files':
        return (
          <>
            <h3 className={title({color: "pink"})} key={endpoint}>File Hub</h3>
          </>
        )
      default:
        return (
          <>
          </>
        );
    }
  }
  let pathname = usePathname();
  return (
    <>
      <Navbar />
      <main className="container mx-auto max-w-7xl pt-6 px-6 flex-grow">
        {renderSwitch(pathname)}
        <Divider className={"mt-6 mb-6"}/>
        {children}
      </main>
      <div className={"sub_div flex flex-row h-5 items-center justify-center space-x-4 text-small self-center"}>
        <div>
          <h1 className={title({color: "violet"})}>ForestGEO&nbsp;</h1>
        </div>
        <Divider orientation={"vertical"} />
        <div>
          <p className={subtitle({color: "cyan"})}>A data entry and validation system for your convenience.</p>
        </div>
      </div>
    </>
  );
}