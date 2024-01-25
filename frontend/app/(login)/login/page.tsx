"use client";
import React, {useEffect, useState} from "react";
import {useSession} from "next-auth/react";
import {animated, useTransition} from "@react-spring/web";
import styles from "@/styles/styles.module.css";
import Sidebar from "@/components/sidebar";
import Box from "@mui/joy/Box";
import EntryModal from "@/components/client/entrymodal";
import {clearAllIDBData} from "@/config/db";

const slides = [
  'background-1.jpg',
  'background-2.jpg',
  'background-3.jpg',
  'background-4.jpg',
]

export default function LoginPage() {
  const {data: _session, status} = useSession();
  const [index, setIndex] = useState(0);
  const [dataIsReset, setDataIsReset] = useState(false);
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
  useEffect(() => {
    const resetIDBStorage = async () => {
      if (status === "unauthenticated" && !dataIsReset) {
        console.log("user not logged in, and data has not been reset");
        await clearAllIDBData();
        setDataIsReset(true);
      } else if (status === "unauthenticated" && dataIsReset) {
        console.log("user not logged in, data is reset");
      } else {
        console.log("user is logged in");
      }
    }
    resetIDBStorage().catch(console.error);
    setInterval(() => setIndex(state => (state + 1) % slides.length), 5000)
  }, [status, dataIsReset]);

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
        <Sidebar/>
      </Box>
    );
  } else {
    return <EntryModal/>;
  }
}