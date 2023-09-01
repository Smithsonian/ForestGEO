"use client";
import * as React from "react";
import {subtitle, title} from "@/components/primitives";
import {useSession} from "next-auth/react";

export default function Page({ params }: { params: { plotKey: string, plotNum: string } }) {
  useSession({
    required: true,
    onUnauthenticated() {
      return (
        <>
          <h1 className={title()}>Welcome to &nbsp;</h1>
          <br />
          <h1 className={title({color: "violet"})}>ForestGEO&nbsp;</h1>
          <br/>
          <h2 className={subtitle({class: "mt-4"})}>
            A data entry and validation system for your convenience.
          </h2>
        </>
      );
    },
  });
  return (
    <>
      <h1 className={title()}>Welcome to &nbsp;</h1>
      <br />
      <h1 className={title({color: "violet"})}>ForestGEO&nbsp;</h1>
      <br/>
      <h2 className={subtitle({class: "mt-4"})}>
        A data entry and validation system for your convenience.
      </h2>
      <p>You have selected {params.plotKey ? params.plotKey : "nothing"}</p>
    </>
  );
}
