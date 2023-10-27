"use client";
import React, {useEffect, useState} from "react";
import {Navbar} from "@/components/navbar";
import {subtitle, title} from "@/config/primitives";
import {useTransition, animated} from "@react-spring/web";
import styles from '@/styles/styles.module.css';
import Divider from "@mui/joy/Divider";

const slides = [
  'background-1.jpg',
  'background-2.jpg',
  'background-3.jpg',
  'background-4.jpg',
]
export default function LoginLayout({ children, }: { children: React.ReactNode; }) {
  const [index, setIndex] = useState(0);
  const transitions = useTransition(index, {
    key: index,
    from: { opacity: 0 },
    enter: { opacity: 0.5 },
    leave: { opacity: 0 },
    config: { duration: 5000 },
    onRest: (_a, _b, item) => {
      if (index == item) {
        setIndex(state => (state + 1) % slides.length)
      }
    },
    exitBeforeEnter: true,
  })
  useEffect(() => void setInterval(() => setIndex(state => (state + 1) % slides.length), 5000), [])
  return (
    <>
      {transitions((style, i) => (
        <animated.div
          className={styles.bg}
          style={{
            ...style,
            backgroundImage: `url(${slides[i]})`,
          }} />
      ))}
      <Navbar />
      <main className="container mx-auto max-w-7xl pt-6 px-6 flex-grow">
        {children}
      </main>
      <div className={"sub_div flex flex-row h-5 items-center justify-center space-x-4 text-small self-center"}>
        <div>
          <h1 className={title({color: "violet"})}>ForestGEO&nbsp;</h1>
        </div>
        <Divider orientation={"vertical"} />
        <div>
          <p className={subtitle({color: "red"})}>A data entry and validation system for your convenience.</p>
        </div>
      </div>
    </>
  );
}