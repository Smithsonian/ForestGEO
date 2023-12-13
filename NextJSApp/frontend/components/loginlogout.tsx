import {signIn, signOut, useSession} from "next-auth/react";
import React from "react";
import Avatar from "@mui/joy/Avatar";
import Box from "@mui/joy/Box";
import Typography from "@mui/joy/Typography";
import IconButton from "@mui/joy/IconButton";
import LogoutRoundedIcon from "@mui/icons-material/LogoutRounded";
import LoginRoundedIcon from "@mui/icons-material/LoginRounded";
import CircularProgress from "@mui/joy/CircularProgress";
import {Skeleton} from "@mui/joy";

export const LoginLogout = () => {
  const {data: session, status} = useSession();
  if (status == "unauthenticated") {
    return (
      <>
        <Box sx={{display: 'flex', gap: 1, alignItems: 'center'}}>
          <Avatar
            variant="outlined"
            size="sm"
          >
            UNK
          </Avatar>
          <Box sx={{minWidth: 0, flex: 1}}>
            <Typography level="title-sm">Login to access</Typography>
            <Typography level="body-xs">your information</Typography>
          </Box>
          <IconButton size="sm" variant="plain" color="neutral"
                      onClick={() => void signIn("azure-ad", {callbackUrl: '/dashboard'})}>
            <LoginRoundedIcon/>
          </IconButton>
        </Box>
      </>
    );
  } else {
    return (
      <>
        <Box sx={{display: 'flex', gap: 1, alignItems: 'center'}}>
          <Avatar
            variant="outlined"
            size="sm"
            src=''>
            <Skeleton loading={status == "loading"}>
              {typeof session?.user?.name == "string" ? session!.user!.name!.replace(/[^a-zA-Z- ]/g, "").match(/\b\w/g)?.join('') : ''}
            </Skeleton>
          </Avatar>
          <Box sx={{minWidth: 0, flex: 1}}>
            <Typography level="title-sm">
              <Skeleton loading={status == "loading"}>
                {session?.user?.name!}
              </Skeleton>
            </Typography>
            <Typography level="body-xs">
              <Skeleton loading={status == "loading"}>
                {session?.user?.email!}
              </Skeleton>
            </Typography>
          </Box>
          <IconButton size="sm" variant="plain" color="neutral" onClick={() => void signOut({callbackUrl: '/login'})}>
            {status == "loading" ? <CircularProgress/> : <LogoutRoundedIcon/>}
          </IconButton>
        </Box>
      </>
    );
  }
  // else { // status == "loading"
  //   return (
  //     <>
  //       <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
  //         <Avatar
  //           variant="outlined"
  //           size="sm"
  //           src=''>
  //           <Skeleton variant={"overlay"} loading={status == "loading"} />
  //         </Avatar>
  //         <Box sx={{ minWidth: 0, flex: 1 }}>
  //           <Typography level="title-sm">{session?.user?.name}</Typography>
  //           <Typography level="body-xs">{session?.user?.email}</Typography>
  //         </Box>
  //         <IconButton size="sm" variant="plain" color="neutral" onClick={() => void signOut({callbackUrl: '/login'})}>
  //           <LogoutRoundedIcon />
  //         </IconButton>
  //       </Box>
  //     </>
  //   );
  // }
}