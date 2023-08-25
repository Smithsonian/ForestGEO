"use client";
import { SessionProvider } from "next-auth/react";
import { Session } from "next-auth";
import React from "react";

export interface AuthContextProps {
  children: React.ReactNode;
  session: Session;
}

export default function AuthContext({ children }: AuthContextProps) {
  return <SessionProvider>{children}</SessionProvider>
}