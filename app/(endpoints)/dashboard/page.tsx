"use client";
import * as React from "react";
import {subtitle, title} from "@/components/primitives";
import {useSession} from "next-auth/react";
import {usePlotContext} from "@/app/plotcontext";
import {Divider} from "@nextui-org/react";

export default function Page() {
  useSession({
    required: true,
    onUnauthenticated() {
      return (
        <>
          <h1 className={title()}>Welcome to &nbsp;</h1>
          <br/>
          <h1 className={title({color: "violet"})}>ForestGEO&nbsp;</h1>
          <br/>
          <h2 className={subtitle({class: "mt-4"})}>
            A data entry and validation system for your convenience.
          </h2>
        </>
      );
    },
  });
  const currentPlot = usePlotContext();
  return (
    <>
      <p>You have selected {currentPlot?.key ? currentPlot!.key : "nothing"}</p>
    </>
  );
}
