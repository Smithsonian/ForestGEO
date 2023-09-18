"use client";
import * as React from "react";
import {NextUIProvider} from "@nextui-org/react";
import {ThemeProvider as NextThemesProvider} from "next-themes";
import {ThemeProviderProps} from "next-themes/dist/types";
import {SessionProvider} from "next-auth/react";
import {PlotsProvider, useCarouselContext} from "@/app/plotcontext";
import {Navbar} from "@/components/navbar";
import {useEffect, useState} from "react";
import { useTransition, animated} from '@react-spring/web';
import styles from '../styles/styles.module.css';

export interface ProvidersProps {
  children: React.ReactNode;
  themeProps?: ThemeProviderProps;
}

const slides = [
  'background-1.jpg',
  'background-2.jpg',
  'background-3.jpg',
  'background-4.jpg',
]

export function Providers({children, themeProps}: ProvidersProps) {
  const [index, setIndex] = useState(0);
  const carouselState = useCarouselContext();
  const transitions = useTransition(index, {
    key: index,
    from: { opacity: 0 },
    enter: { opacity: 0.5 },
    leave: { opacity: 0 },
    config: { duration: 5000 },
    onRest: (_a, _b, item) => {
      if (index === item) {
        setIndex(state => (state + 1) % slides.length)
      }
    },
    exitBeforeEnter: true,
  })
  useEffect(() => void setInterval(() => setIndex(state => (state + 1) % slides.length), 5000), [])
  return (
    <>
      <head>
        <title>ForestGEO Data Entry</title>
      </head>
      <SessionProvider>
        <NextUIProvider>
          <NextThemesProvider {...themeProps}>
            <body>
            {transitions((style, i) => (
              <animated.div
                className={styles.bg}
                style={{
                  ...style,
                  backgroundImage: `url(${slides[i]})`,
                }} />
            ))}
            <div className={"absolute flex flex-col h-screen w-screen"}>
              <Navbar>
                {children}
              </Navbar>
            </div>
            </body>
          </NextThemesProvider>
        </NextUIProvider>
      </SessionProvider>
    </>
  );
}
