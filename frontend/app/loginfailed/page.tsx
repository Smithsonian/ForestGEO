import LoginFailed from "@/components/client/loginfailure";
import {Suspense} from "react";

export default function LoginFailedPage() {
  return (
    <Suspense>
      <LoginFailed/>
    </Suspense>
  )
}