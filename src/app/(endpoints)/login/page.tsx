"use client";
import {signIn, signOut, useSession} from "next-auth/react";

export default function Login() {
  const { data: session } = useSession();
  if (session) {
    return (
      <>
        Signed in as {session?.user?.email} <br />
        <button onClick={() => signOut()}>sign out</button>
      </>
    );
  }
  return (
    <>
      Not signed in <br />
      <button
        onClick={() => {
          console.log("logging in?");
          signIn();
        }}
      >
        Sign in
      </button>
    </>
  );
}