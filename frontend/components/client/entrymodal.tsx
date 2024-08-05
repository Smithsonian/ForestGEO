"use client";
import React from "react";
import { useFirstLoadContext, useFirstLoadDispatch } from "@/app/contexts/listselectionprovider";
import { Button, DialogActions, DialogContent, DialogTitle, Modal, ModalDialog, Stack, Typography } from "@mui/joy";
import WarningRoundedIcon from "@mui/icons-material/WarningRounded";
import Divider from "@mui/joy/Divider";
import { redirect } from "next/navigation";
import { useSession } from "next-auth/react";

export default function EntryModal() {
  const { data: _session, status } = useSession();
  const firstLoad = useFirstLoadContext();
  const firstLoadDispatch = useFirstLoadDispatch();
  return (
    <>
      {firstLoad && status !== "unauthenticated" ? (
        <Modal
          open={firstLoad}
          sx={{ display: "flex", flex: 1 }}
          onClose={(_event: React.MouseEvent<HTMLButtonElement>, reason: string) => {
            if (reason !== "backdropClick" && reason !== "escapeKeyDown") {
              return firstLoadDispatch ? firstLoadDispatch({ firstLoad: false }) : undefined;
            }
          }}
        >
          <ModalDialog variant="outlined" role="alertdialog">
            <DialogTitle>
              <WarningRoundedIcon />
              <Typography level={"title-lg"}>Welcome to the Application!</Typography>
            </DialogTitle>
            <Divider />
            <DialogContent>
              <Stack direction={"column"} sx={{ display: "flex", flex: 1 }}>
                <Typography level={"body-sm"}>
                  Select <b>Core Measurements Hub</b> to view existing core measurement data for a given plot, census, and quadrat
                </Typography>
                <Typography level={"body-sm"}>
                  Select <b>CSV & ArcGIS File Upload Hub</b> to upload core measurements in either CSV format or in collected ArcGIS format
                </Typography>
                <Typography level={"body-sm"}>
                  Select <b>Measurement Properties Hub</b> to view and edit measurement properties used in data collection
                </Typography>
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button variant="plain" color="neutral" onClick={() => (firstLoadDispatch ? firstLoadDispatch({ firstLoad: false }) : null)}>
                Continue
              </Button>
            </DialogActions>
          </ModalDialog>
        </Modal>
      ) : (
        status === "authenticated" && redirect("/dashboard")
      )}
    </>
  );
}
