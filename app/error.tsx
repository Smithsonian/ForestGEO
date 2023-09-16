'use client'

import React, {useEffect} from 'react'
import {Card, CardBody, Divider} from "@nextui-org/react";
import {CardHeader} from "@nextui-org/card";

export default function Error({
                                error,
                                reset,
                              }: {
  error: Error
  reset: () => void
}) {
  useEffect(() => {
    // Log the error to an error files service
    console.error(error)
  }, [error])
  
  return (
    <div>
      <h2>Something went wrong!</h2>
      <button
        onClick={
          // Attempt to recover by trying to re-render the segment
          () => reset()
        }
      >
        Try again
      </button>
    </div>
  )
}

export function BrowseError() {
  return (
    <>
      <Card className="flex flex-col items-center justify-center gap-4 py-8 md:py-10">
        <CardHeader>
          <div className="flex flex-col">
            <h5 className="text-md">Error while loading data.</h5>
          </div>
        </CardHeader>
        <Divider/>
        <CardBody>
          <div className="flex flex-col">
            <h6 className="text-md">Perhaps try reloading the page. If it still doesn&apos;t work, please again
              a bit later.</h6>
          </div>
        </CardBody>
      </Card>
    </>
  );
}