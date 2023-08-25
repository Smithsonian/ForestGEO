import './globals.css';
import {Inter} from 'next/font/google';
import React from "react";
import AuthContext from "@/app/components/authcontext";
import {Session} from "next-auth";
import {headers} from "next/headers";

async function getSession(cookie: string) : Promise<Session> {
  const response = await fetch(`http://localhost:3000/api/auth/session`);
  const session = await response.json();
  return Object.keys(session).length > 0 ? session: null;
}

const inter = Inter({subsets: ['latin']});
export default async function RootLayout({
                                     children,
                                   }: {
  children: React.ReactNode
}) {
  const session = await getSession(headers().get('cookie') ?? '');
  return (
    <html lang="en" className={"dark"}>
      <body className={inter.className}>
        <AuthContext session={session}>
          {children}
        </AuthContext>
      </body>
    </html>
  )
}