"use client";
import React, {useEffect, useState} from "react";
import {useTransition, animated} from "@react-spring/web";
import styles from '@/styles/styles.module.css';
import Header from "@/components/header";
import Sidebar from "@/components/sidebar";
import {Box, Breadcrumbs, Link as JoyLink} from "@mui/joy";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import Link from "next/link";
import HomeRoundedIcon from "@mui/icons-material/HomeRounded";
import Typography from "@mui/joy/Typography";
import Button from "@mui/joy/Button";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import OrderTable from "@/components/ordertable";
import OrderList from "@/components/orderlist";

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
      {children}
    </>
  );
}