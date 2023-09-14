"use client";

import {useSession} from "next-auth/react";
import {title} from "@/components/primitives";
import ViewUploadedFiles from "@/components/viewuploadedfiles";

export default function Browse() {
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
  return <ViewUploadedFiles />;
}