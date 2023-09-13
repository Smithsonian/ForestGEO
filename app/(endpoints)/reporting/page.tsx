"use client";
import {subtitle, title} from "@/components/primitives";
import * as React from "react";
import {useSession} from "next-auth/react";
import {usePlotContext} from "@/app/plotcontext";

export default function Page() {
  useSession({
    required: true,
    onUnauthenticated() {
      return (
        <>
          <h3 className={title()}>You must log in to view this page.</h3>
        </>
      );
    },
  });
  const currentPlot = usePlotContext();
  return (
    <>
      <h3 className={subtitle()}>Currently at reporting page,
        viewing {currentPlot!.key ? currentPlot!.key : "error: no plot selected"}</h3>
    </>
  );
}
