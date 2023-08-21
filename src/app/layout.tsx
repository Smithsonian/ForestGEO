import './globals.css';
import { Inter } from 'next/font/google';
import NavBar from "@/app/components/navbar";
import React from "react";

const inter = Inter({ subsets: ['latin'] });
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
      <NavBar />
      {children}
      </body>
    </html>
  )
}