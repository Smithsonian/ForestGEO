"use client";
import React, {useEffect, useState} from "react";
import {useSession} from "next-auth/react";
import {animated, useTransition} from "@react-spring/web";
import styles from "@/styles/styles.module.css";
import Box from "@mui/joy/Box";
import UnauthenticatedSidebar from "@/components/unauthenticatedsidebar";
import {redirect} from "next/navigation";

const slides = [
  'background-1.jpg',
  'background-2.jpg',
  'background-3.jpg',
  'background-4.jpg',
]

export default function LoginPage() {
  const {data: _session, status} = useSession();
  const [index, setIndex] = useState(0);
  const transitions = useTransition(index, {
    key: index,
    from: { opacity: 0 },
    enter: { opacity: 0.5 },
    leave: { opacity: 0 },
    config: { duration: 5000 },
    onRest: (_a, _b, item) => {
      if (index === item) {
        setIndex(state => (state + 1) % slides.length);
      }
    },
    exitBeforeEnter: true,
  });

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex(state => (state + 1) % slides.length);
    }, 5000);
    return () => clearInterval(interval); // Clear the interval when the component unmounts or dependencies change
  }, []);

  if (status === "unauthenticated") {
    return (
      <Box sx={{display: 'flex', minHeight: '100vh', minWidth: '100vh'}}>
        {transitions((style, i) => (
          <animated.div
            className={styles.bg}
            style={{
              ...style,
              backgroundImage: `url(${slides[i]})`,
            }}/>
        ))}
        <UnauthenticatedSidebar/>
      </Box>
    );
  } else if (status === "authenticated") {
    redirect('/dashboard');
  }
}