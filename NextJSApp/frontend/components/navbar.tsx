"use client";
import React from "react";
import {usePathname} from "next/navigation";
import {usePlotContext} from "@/app/plotcontext";
import {useSession} from "next-auth/react";

export function Navbar () {
  const {status} = useSession();
  let pathname = usePathname();
  let currentPlot = usePlotContext();
  return (
    <>
    {/*  <NextUINavbar maxWidth="xl" position="static" shouldHideOnScroll classNames={{*/}
    {/*  item: [*/}
    {/*    "flex",*/}
    {/*    "relative",*/}
    {/*    "h-full",*/}
    {/*    "items-center",*/}
    {/*    "data-[active=true]:after:content-['']",*/}
    {/*    "data-[active=true]:after:absolute",*/}
    {/*    "data-[active=true]:after:bottom-0",*/}
    {/*    "data-[active=true]:after:left-0",*/}
    {/*    "data-[active=true]:after:right-0",*/}
    {/*    "data-[active=true]:after:h-[2px]",*/}
    {/*    "data-[active=true]:after:rounded-[2px]",*/}
    {/*    "data-[active=true]:after:bg-primary",*/}
    {/*  ],*/}
    {/*}}>*/}
    {/*  <NavbarContent className="basis-1/5 sm:basis-full" justify="start">*/}
    {/*    <NavbarBrand as="li" className="gap-3 max-w-fit">*/}
    {/*      <Link href={(status == "unauthenticated") ? "#" : "/dashboard"} className="flex justify-start items-center gap-1">*/}
    {/*        <Logo/>*/}
    {/*        <p className={clsx(*/}
    {/*          linkStyles({color: (status == "unauthenticated" ? "danger" : "foreground"), size: "lg"}))}>*/}
    {/*          ForestGEO</p>*/}
    {/*      </Link>*/}
    {/*    </NavbarBrand>*/}
    {/*    <ul className="hidden lg:flex gap-4 justify-start ml-2">*/}
    {/*      {siteConfig.navItems.map((item) => {*/}
    {/*        return (*/}
    {/*          <>*/}
    {/*            <NavbarItem key={item.label} isActive={(pathname == item.href)}>*/}
    {/*              <Link*/}
    {/*                className={clsx(*/}
    {/*                  linkStyles({color: (status == "unauthenticated" ? "danger" : "foreground"), size: "lg"}),*/}
    {/*                  "data-[active=true]:text-primary data-[active=true]:font-medium"*/}
    {/*                )}*/}
    {/*                href={(currentPlot?.key != 'none') ? item.href : '#'}>*/}
    {/*                {item.label}*/}
    {/*              </Link>*/}
    {/*            </NavbarItem>*/}
    {/*          </>*/}
    {/*        );*/}
    {/*      })}*/}
    {/*    </ul>*/}
    {/*  </NavbarContent>*/}
    {/*  <NavbarContent className={"basis-1/5 sm:basis-full"} justify={"start"} />*/}
    {/*  <NavbarContent className="hidden sm:flex basis-1/5 sm:basis-full" justify="end" />*/}
    {/*  <NavbarContent className="hidden sm:flex basis-1/5 sm:basis-full" justify="end" >*/}
    {/*    <SelectPlot />*/}
    {/*  </NavbarContent>*/}
    {/*  <NavbarContent className="hidden sm:flex basis-2/5 sm:basis-full" justify="end">*/}
    {/*    <LoginLogout/>*/}
    {/*  </NavbarContent>*/}
    {/*</NextUINavbar>*/}
    </>
  );
}
