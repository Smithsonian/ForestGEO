"use client";
import {
  Card,
  CardBody,
  Divider,
  Navbar as NextUINavbar,
  NavbarBrand,
  NavbarContent,
  NavbarItem,
} from "@nextui-org/react";
import {link as linkStyles} from "@nextui-org/react";
import {siteConfig} from "@/config/macros";
import Link from "next/link";
import clsx from "clsx";
import {Logo} from "@/components/icons";
import React from "react";
import {LoginLogout} from "@/components/loginlogout";
import {SelectPlot} from "@/components/plotselection";
import {usePathname} from "next/navigation";
import {subtitle, title} from "@/components/primitives";
import {usePlotContext} from "@/app/plotcontext";

export function Navbar ({children,} : {children: React.ReactNode}) {
  function renderSwitch(endpoint: string) {
    switch (endpoint) {
      case '/dashboard':
        return (
          <>
            <h3 className={title({color: "cyan"})} key={endpoint}>Dashboard View</h3>
          </>
        )
      case '/data':
        return (
          <>
            <h2 className={title({color: "green"})} key={endpoint}>Data Hub</h2>
          </>
        )
      case '/files':
        return (
          <>
            <h3 className={title({color: "pink"})} key={endpoint}>File Hub</h3>
          </>
        )
      default:
        return (
          <>
          </>
        );
    }
  }
  let pathname = usePathname();
  let currentPlot = usePlotContext();
  return (
    <>
      <NextUINavbar maxWidth="xl" position="static" shouldHideOnScroll classNames={{
        item: [
          "flex",
          "relative",
          "h-full",
          "items-center",
          "data-[active=true]:after:content-['']",
          "data-[active=true]:after:absolute",
          "data-[active=true]:after:bottom-0",
          "data-[active=true]:after:left-0",
          "data-[active=true]:after:right-0",
          "data-[active=true]:after:h-[2px]",
          "data-[active=true]:after:rounded-[2px]",
          "data-[active=true]:after:bg-primary",
        ],
      }}>
        <NavbarContent className="basis-1/5 sm:basis-full" justify="start">
          <NavbarBrand as="li" className="gap-3 max-w-fit">
            <Link href={"/dashboard"} className="flex justify-start items-center gap-1">
              <Logo/>
              <p className="font-bold text-inherit">ForestGEO</p>
            </Link>
          </NavbarBrand>
          <ul className="hidden lg:flex gap-4 justify-start ml-2">
            {siteConfig.navItems.map((item) => {
              return (
                <>
                  <NavbarItem key={item.label} isActive={(pathname === item.href)}>
                    <Link
                      className={clsx(
                        linkStyles({color: "foreground"}),
                        "data-[active=true]:text-primary data-[active=true]:font-medium"
                      )}
                      color="foreground"
                      href={(currentPlot?.key != 'none') ? item.href : '#'}>
                      {item.label}
                    </Link>
                  </NavbarItem>
                </>
              );
            })}
          </ul>
        </NavbarContent>
        <NavbarContent className={"basis-1/5 sm:basis-full"} justify={"start"} />
        <NavbarContent className="hidden sm:flex basis-1/5 sm:basis-full" justify="end" />
        <NavbarContent className="hidden sm:flex basis-1/5 sm:basis-full" justify="end" >
          <SelectPlot />
        </NavbarContent>
        <NavbarContent className="hidden sm:flex basis-2/5 sm:basis-full" justify="end">
          <LoginLogout/>
        </NavbarContent>
      </NextUINavbar>
      <main className="container mx-auto max-w-7xl pt-6 px-6 flex-grow">
        {renderSwitch(pathname)}
        <Divider className={"mt-6 mb-6"}/>
        <div className="flex-1 flex-col items-center justify-stretch gap-4 py-8 md:py-10">
          {children}
        </div>
        {/*</div>*/}
        {/*<section className="flex flex-col items-center justify-center gap-4 py-8 md:py-10">*/}
        {/*  <div className="inline-block max-w-lg text-center justify-center">*/}
        {/*  */}
        {/*  </div>*/}
        {/*</section>*/}
      </main>
      <div className={"sub_div flex flex-row h-5 items-center justify-center space-x-4 text-small self-center"}>
        <div>
          <h1 className={title({color: "violet"})}>ForestGEO&nbsp;</h1>
        </div>
        <Divider orientation={"vertical"} />
        <div>
          <p className={subtitle({color: "cyan"})}>A data entry and validation system for your convenience.</p>
        </div>
      </div>
    </>
  );
}
