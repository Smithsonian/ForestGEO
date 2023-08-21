"use client";
import './globals.css';
import { Inter } from 'next/font/google';
import NavBar from "@/app/components/navbar";
import React from "react";
import {SessionProvider} from "next-auth/react";

const inter = Inter({ subsets: ['latin'] });
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head />
      <body className={inter.className}>
        <SessionProvider>
          <NavBar />
          {children}
        </SessionProvider>
      </body>
    </html>
  )
}