"use client";
import {subtitle, title} from "@/components/primitives";
import * as React from "react";
import {useSession} from "next-auth/react";

export default function Page({params}: { params: { plotKey: string, plotNum: string } }) {
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
  return (
    <>
      <h3 className={subtitle()}>Currently at reporting page,
        viewing {params.plotKey ? params.plotKey : "error: no plot selected"}</h3>
    </>
  );
}
