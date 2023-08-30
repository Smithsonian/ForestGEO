"use client";
import {
  Navbar as NextUINavbar,
  NavbarContent,
  NavbarBrand,
  NavbarItem,
} from "@nextui-org/navbar";
import {
  Select,
  SelectItem,
  Selection
} from "@nextui-org/react";
import {link as linkStyles} from "@nextui-org/theme";
import {Plot, plots} from "@/config/site";
import NextLink from "next/link";
import clsx from "clsx";
import {Logo} from "@/components/icons";
import React, {Dispatch, SetStateAction, useEffect, useState} from "react";
import {LoginLogout} from "@/components/loginlogout";

export const Navbar = () => {
  const keys = plots.map(plot => {
    return {
      key: plot.key
    };
  });
  const initialState: Plot = {key: '', num: 0};
  const [localPlot, setLocalPlot] = useState(initialState);
  const [selection, setSelection] = useState<Selection>(new Set([]));
  
  useEffect(() => {
    setLocalPlot(plots.find((plot) => (plot.key === Array.from(selection)[0])) as Plot);
  }, [selection]);
  
  return (
    <NextUINavbar maxWidth="xl" position="sticky">
      <NavbarContent className="basis-1/5 sm:basis-full" justify="start">
        <NavbarBrand as="li" className="gap-3 max-w-fit">
          <NextLink className="flex justify-start items-center gap-1" href="/">
            <Logo/>
            <p className="font-bold text-inherit">ForestGEO</p>
          </NextLink>
        </NavbarBrand>
        <ul className="hidden lg:flex gap-4 justify-start ml-2">
          <NavbarItem key={"browse"}>
            <NextLink
              className={clsx(
                linkStyles({color: "foreground"}),
                "data-[active=true]:text-primary data-[active=true]:font-medium"
              )}
              color="foreground"
              href={`/browse/${(localPlot !== undefined) ? localPlot.key : ""}`}>
              Browse
            </NextLink>
          </NavbarItem>
          <NavbarItem key={"reporting"}>
            <NextLink
              className={clsx(
                linkStyles({color: "foreground"}),
                "data-[active=true]:text-primary data-[active=true]:font-medium"
              )}
              color="foreground"
              href={`/reporting/${(localPlot !== undefined) ? localPlot.key : ""}`}>
              Reporting
            </NextLink>
          </NavbarItem>
          <NavbarItem key={"validation"}>
            <NextLink
              className={clsx(
                linkStyles({color: "foreground"}),
                "data-[active=true]:text-primary data-[active=true]:font-medium"
              )}
              color="foreground"
              href={`/validation/${(localPlot !== undefined) ? localPlot.key : ""}`}>
              Validation
            </NextLink>
          </NavbarItem>
        </ul>
      </NavbarContent>
      <NavbarContent
        className="hidden sm:flex basis-1/5 sm:basis-full"
        justify="end"
      >
      </NavbarContent>
      <NavbarContent
        className="hidden sm:flex basis-1/5 sm:basis-full"
        justify="end"
      >
      </NavbarContent>
      
      <NavbarContent
        className="hidden sm:flex basis-1/5 sm:basis-full"
        justify="end"
      >
        <Select
          label="Select Plot"
          variant="bordered"
          placeholder="Select a plot"
          className="max-w-xs"
          items={keys}
          selectedKeys={selection}
          onSelectionChange={setSelection}
        >
          {(plotKey) => <SelectItem key={plotKey.key}>{plotKey.key}</SelectItem> }
        </Select>
      </NavbarContent>
      <NavbarContent as={"div"}
                     justify="end">
        <LoginLogout />
      </NavbarContent>
    </NextUINavbar>
  );
};
