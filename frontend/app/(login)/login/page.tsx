"use client";
import React, {useEffect, useState} from "react";
import {useSession} from "next-auth/react";
import {redirect} from "next/navigation";
import {animated, useTransition} from "@react-spring/web";
import styles from "@/styles/styles.module.css";
import Sidebar from "@/components/sidebar";
import Box from "@mui/joy/Box";

const slides = [
  'background-1.jpg',
  'background-2.jpg',
  'background-3.jpg',
  'background-4.jpg',
]

export default function Page() {
  const [index, setIndex] = useState(0);
  const transitions = useTransition(index, {
    key: index,
    from: {opacity: 0},
    enter: {opacity: 0.5},
    leave: {opacity: 0},
    config: {duration: 5000},
    onRest: (_a, _b, item) => {
      if (index == item) {
        setIndex(state => (state + 1) % slides.length)
      }
    },
    exitBeforeEnter: true,
  })
  useEffect(() => void setInterval(() => setIndex(state => (state + 1) % slides.length), 5000), [])
  const {status} = useSession();
  if (status == "authenticated") redirect('/dashboard');
  else
    return (
      <>
        <Box sx={{display: 'flex', minHeight: '100vh', minWidth: '100vh'}}>
          {transitions((style, i) => (
            <animated.div
              className={styles.bg}
              style={{
                ...style,
                backgroundImage: `url(${slides[i]})`,
              }}/>
          ))}
          <Sidebar/>
        </Box>
      </>
    );
}