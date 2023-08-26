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
import React, {Dispatch, SetStateAction, useState} from "react";
import { useRouter } from "next/navigation";

export interface Plot {
  key: string;
  num: number;
}

export interface SelectPlotProps {
  plot: Plot;
  setPlot: Dispatch<SetStateAction<Plot>>;
}

export const Navbar = (props: SelectPlotProps) => {
  const router = useRouter();
  const plots: Plot[] = [];
  siteConfig.plotItems.forEach((e) => {
    plots.push({ key: e.key, num: e.count } as Plot);
  });
  const [value, setValue] = useState<Selection>(new Set([]));
  const handleSelectionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setValue(new Set([e.target.value]));
    props.setPlot(plots.find((plot) => {
      if(plot.key === e.target.value) return plot;
    }) as Plot);
  };
  
  const onClick = async (event: { preventDefault: () => void; }) => {
    event.preventDefault();
    if(props.plot === undefined || props.plot.key === undefined) {
      alert("You must select a plot before continuing!");
    }
  }
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
              href={`/browse/${props.plot.key}`}
              onClick={onClick}>
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
              href={`/reporting/${props.plot.key}`}
              onClick={onClick}>
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
              href={`/validation/${props.plot.key}`}
              onClick={onClick}>
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
          defaultSelectedKeys={[props.plot.key]}
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
