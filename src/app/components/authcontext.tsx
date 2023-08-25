"use client";
import { SessionProvider } from "next-auth/react";
import { Session } from "next-auth";
import React, {useState} from "react";
import NavBar from "@/app/components/navbar";
import {NextUIProvider} from "@nextui-org/react";
import {Plot} from "@/app/components/plotselection";

export interface AuthContextProps {
  children: React.ReactNode;
  session: Session;
}

export default function AuthContext({ children }: AuthContextProps) {
  const initialState: Plot = { key: "", count: 0};
  const [plot, setPlot] = useState(initialState);
  return (
    <NextUIProvider>
      <SessionProvider>
        <NavBar plot={plot} setPlot={setPlot}/>
        {children}
      </SessionProvider>
    </NextUIProvider>
  );
}