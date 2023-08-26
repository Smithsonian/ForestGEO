"use client";
import {
  Navbar as NextUINavbar,
  NavbarContent,
  NavbarBrand,
  NavbarItem,
} from "@nextui-org/navbar";
import {Select, SelectItem, Selection} from "@nextui-org/react";
import {link as linkStyles} from "@nextui-org/theme";
import {siteConfig} from "@/config/site";
import NextLink from "next/link";
import clsx from "clsx";
import {Logo} from "@/components/icons";
import React, {useState} from "react";
export interface Plot {
  name: string;
  num: number;
}

export const Navbar = () => {
  const [value, setValue] = useState<Selection>(new Set([]));
  const initialState: Plot = {name: '', num: 0};
  const [currentPlot, setCurrentPlot] = useState(initialState);
  const handleSelectionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setValue(new Set([e.target.value]));
    setCurrentPlot({name: e.target.value, num: siteConfig.plotItems.find(e.target.value)?.count?});
  };
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
              href={`/browse/${currentPlot}`}>
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
              href={`/reporting/${currentPlot}`}>
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
              href={`/validation/${currentPlot}`}>
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
          label="Current Plot"
          variant="bordered"
          placeholder="Select a plot: "
          isRequired={true}
          defaultSelectedKeys={["Amacayacu"]}
          selectedKeys={value}
          className="max-w-xs"
          onChange={handleSelectionChange}
        >
          {siteConfig.plotItems.map((plot) => (
            <SelectItem key={plot.key} value={plot.key}>
              {plot.key}
            </SelectItem>
          ))}
        </Select>
      </NavbarContent>
    </NextUINavbar>
  );
};
