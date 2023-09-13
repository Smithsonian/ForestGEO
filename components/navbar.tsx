"use client";
import {Navbar as NextUINavbar, NavbarBrand, NavbarContent, NavbarItem,} from "@nextui-org/react";
import {link as linkStyles} from "@nextui-org/react";
import {Plot, siteConfig} from "@/config/site";
import NextLink from "next/link";
import clsx from "clsx";
import {Logo} from "@/components/icons";
import React, {useEffect, useState} from "react";
import {LoginLogout} from "@/components/loginlogout";
import {SelectPlot} from "@/components/plotselection";
import {usePathname, useRouter} from "next/navigation";

export const Navbar = () => {
  const initialState: Plot = {key: 'none', num: 0};
  const [localPlot, setLocalPlot] = useState(initialState);
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    // navbar-centralized route updating needed to keep the pages updated when user selects a new plot while at an endpoint
    if (localPlot && localPlot.key) {
      let pathPieces = pathname.split('/');
      if (pathPieces.length === 2) {
        // navigated to an endpoint but no local plot was selected
        router.push(`/${pathPieces[1]}/${localPlot.key}/${localPlot.num.toString()}`);
      } else if (pathPieces.length === 4 && (pathPieces[2] !== localPlot.key || pathPieces[3] !== localPlot.num.toString())) {
        // a new plot was selected while on an endpoint
        pathPieces[2] = localPlot.key; // change to new localplot KEY
        pathPieces[3] = localPlot.num.toString(); // change to new localplot NUM
        router.push(pathPieces.join('/'));
      }
    }
  }, [localPlot, pathname, router]);
  return (
    <NextUINavbar maxWidth="xl" position="sticky">
      <NavbarContent className="basis-1/5 sm:basis-full" justify="start">
        <NavbarBrand as="li" className="gap-3 max-w-fit">
          <NextLink className="flex justify-start items-center gap-1" href="/home/none/0">
            <Logo/>
            <p className="font-bold text-inherit">ForestGEO</p>
          </NextLink>
        </NavbarBrand>
        <ul className="hidden lg:flex gap-4 justify-start ml-2">
          {siteConfig.navItems.map((item) => (
            <NavbarItem key={item.label}>
              <NextLink
                className={clsx(
                  linkStyles({color: "foreground"}),
                  "data-[active=true]:text-primary data-[active=true]:font-medium"
                )}
                color="foreground"
                href={`${item.href}/${!localPlot ? 'none' : localPlot.key}/${!localPlot ? '0' : localPlot.num.toString()}`}>
                {item.label}
              </NextLink>
            </NavbarItem>
          ))}
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
        <SelectPlot plot={localPlot} setPlot={setLocalPlot}/>
      </NavbarContent>
      <NavbarContent className="hidden sm:flex basis-2/5 sm:basis-full"
                     justify="end">
        <LoginLogout/>
      </NavbarContent>
    </NextUINavbar>
  );
};
