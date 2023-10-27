import {signIn, signOut, useSession} from "next-auth/react";
import React from "react";
import Avatar from "@mui/joy/Avatar";
import Box from "@mui/joy/Box";
import Typography from "@mui/joy/Typography";
import IconButton from "@mui/joy/IconButton";
import LogoutRoundedIcon from "@mui/icons-material/LogoutRounded";
import LoginRoundedIcon from "@mui/icons-material/LoginRounded";
import CircularProgress from "@mui/joy/CircularProgress";

export const LoginLogout = () => {
  const {data: session, status} = useSession();
  const handleLogin = (event: React.ChangeEvent<unknown>) => {
    signIn().then();
  };
  const handleLogout = (event: React.ChangeEvent<unknown>) => {
    signOut().then();
  }
  if (status == "unauthenticated") {
    return (
      <>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <Avatar
            variant="outlined"
            size="sm"
          >
            UNK
          </Avatar>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography level="title-sm">Login to access</Typography>
            <Typography level="body-xs">your information</Typography>
          </Box>
          <IconButton size="sm" variant="plain" color="neutral" onClick={handleLogin}>
            <LoginRoundedIcon />
          </IconButton>
        </Box>
      </>
    );
  } else if (status == "authenticated") {
    return (
      <>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <Avatar
            variant="outlined"
            size="sm"
            src='/broken-image.jpg'
          />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography level="title-sm">{session?.user?.name}</Typography>
            <Typography level="body-xs">{session?.user?.email}</Typography>
          </Box>
          <IconButton size="sm" variant="plain" color="neutral" onClick={handleLogout}>
            <LogoutRoundedIcon />
          </IconButton>
        </Box>
      </>
    );
  } else {
    // Loading State
    return <CircularProgress />;
    // return <Spinner label={"Loading..."} color={"primary"} labelColor="primary"/>;
  }
}