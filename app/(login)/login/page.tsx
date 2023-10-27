"use client";
import {subtitle, title} from "@/config/primitives";
import React from "react";
import {useSession} from "next-auth/react";
import {redirect} from "next/navigation";
import Divider from "@mui/joy/Divider";

export default function Page() {
  const {data: session} = useSession();
  if (session) redirect('/dashboard');
  return (
    <>
      <h1 className={title()}>Welcome to &nbsp;</h1>
      <h1 className={title({color: "violet"})}>ForestGEO</h1>
      <Divider className={"mt-6 mb-6"}/>
      <h2 className={subtitle({class: "mt-4"})}>
        A data entry and validation system for your convenience.
      </h2>
    </>
  );
}