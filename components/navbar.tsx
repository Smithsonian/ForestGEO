import {Navbar as NextUINavbar, NavbarBrand, NavbarContent, NavbarItem,} from "@nextui-org/react";
import {link as linkStyles} from "@nextui-org/react";
import {siteConfig} from "@/config/site";
import NextLink from "next/link";
import clsx from "clsx";
import {Logo} from "@/components/icons";
import React from "react";
import {LoginLogout} from "@/components/loginlogout";
import {SelectPlot} from "@/components/plotselection";

export const Navbar = ({children,} : {children: React.ReactNode}) => {
  return (
    <>
      <div className="relative flex flex-col h-screen">
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
                    href={`${item.href}`}>
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
            <SelectPlot />
          </NavbarContent>
          <NavbarContent className="hidden sm:flex basis-2/5 sm:basis-full"
                         justify="end">
            <LoginLogout/>
          </NavbarContent>
        </NextUINavbar>
        <main className="container mx-auto max-w-7xl pt-16 px-6 flex-grow">
          {children}
          {/*<section className="flex flex-col items-center justify-center gap-4 py-8 md:py-10">*/}
          {/*  <div className="inline-block max-w-lg text-center justify-center">*/}
          {/*  */}
          {/*  </div>*/}
          {/*</section>*/}
        </main>
        <footer className="w-full flex items-center justify-center py-3">
        </footer>
      </div>
    </>
  );
};
