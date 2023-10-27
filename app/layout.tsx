import "@/styles/globals.css";
import {Providers} from "./providers";
import React from "react";
import {PlotsProvider} from "@/app/plotcontext";
import Header from "@/components/header";
import Sidebar from "@/components/sidebar";
import {Box, Breadcrumbs, Link as JoyLink} from "@mui/joy";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import Link from "next/link";
import HomeRoundedIcon from "@mui/icons-material/HomeRounded";
import Typography from "@mui/joy/Typography";
import Button from "@mui/joy/Button";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import OrderTable from "@/components/ordertable";
import OrderList from "@/components/orderlist";
export default function RootLayout({ children, }: { children: React.ReactNode; }) {
  return (
    <>
      <html lang="en" suppressContentEditableWarning suppressHydrationWarning className={"dark"} >
      <head>
        <title>ForestGEO Data Entry</title>
      </head>
      <PlotsProvider>
        <Providers>
          <Box sx={{ display: 'flex', minHeight: '100dvh' }}>
            <Header />
            <Sidebar />
            <Box
              component="main"
              className="MainContent"
              sx={{
                px: {
                  xs: 2,
                  md: 6,
                },
                pt: {
                  xs: 'calc(12px + var(--Header-height))',
                  sm: 'calc(12px + var(--Header-height))',
                  md: 3,
                },
                pb: {
                  xs: 2,
                  sm: 2,
                  md: 3,
                },
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                minWidth: 0,
                height: '100dvh',
                gap: 1,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Breadcrumbs
                  size="sm"
                  aria-label="breadcrumbs"
                  separator={<ChevronRightRoundedIcon fontSize="small" />}
                  sx={{ pl: 0 }}
                >
                  <Link href={"#"}>
                    <JoyLink
                      underline="none"
                      color="neutral"
                      href="#some-link"
                      aria-label="Home"
                    >
                      <HomeRoundedIcon />
                    </JoyLink>
                  </Link>
                  <Link href={"#"}>
                    <JoyLink
                      underline="hover"
                      color="neutral"
                      href="#some-link"
                      fontSize={12}
                      fontWeight={500}
                    >
                      Dashboard
                    </JoyLink>
                  </Link>
                  <Typography color="primary" fontWeight={500} fontSize={12}>
                    Orders
                  </Typography>
                </Breadcrumbs>
              </Box>
              {/*<Box*/}
              {/*  sx={{*/}
              {/*    display: 'flex',*/}
              {/*    my: 1,*/}
              {/*    gap: 1,*/}
              {/*    flexDirection: { xs: 'column', sm: 'row' },*/}
              {/*    alignItems: { xs: 'start', sm: 'center' },*/}
              {/*    flexWrap: 'wrap',*/}
              {/*    justifyContent: 'space-between',*/}
              {/*  }}*/}
              {/*>*/}
              {/*  <Typography level="h2">Orders</Typography>*/}
              {/*  <Button*/}
              {/*    color="primary"*/}
              {/*    startDecorator={<DownloadRoundedIcon />}*/}
              {/*    size="sm"*/}
              {/*  >*/}
              {/*    Download PDF*/}
              {/*  </Button>*/}
              {/*</Box>*/}
            </Box>
          </Box>
        </Providers>
      </PlotsProvider>
      </html>
    </>
  );
}
