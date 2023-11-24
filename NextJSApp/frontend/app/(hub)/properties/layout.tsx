import {Box} from "@mui/joy";
import * as React from "react";

export default function PropertiesLayout({children,}: { children: React.ReactNode }) {
  
  return (
    <>
      <Box sx={{
        display: 'flex',
        flexGrow: 1,
        flexShrink: 1,
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        {children}
      </Box>
    </>
  );
}