import {signIn, signOut, useSession} from "next-auth/react";
import {Avatar, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Spinner} from "@nextui-org/react";
import React from "react";
import {UserIconChecked, UserIconXMarked} from "@/components/icons";

export const LoginLogout = () => {
  const { data: session, status} = useSession();
  if (status === "unauthenticated") {
    return (
      <>
        <Dropdown placement="bottom-end">
          <DropdownTrigger>
            <Avatar
              isBordered
              as="button"
              className="transition-transform"
              color="secondary"
              name="Unknown User"
              size="sm"
              icon={<UserIconXMarked />}
            />
          </DropdownTrigger>
          <DropdownMenu
            aria-label="Profile Actions"
            variant="flat"
            onAction={(key) => (key === "login") ? void signIn("azure-ad") : alert(key)}
          >
            <DropdownItem key="profile" className="h-14 gap-2">
              <p className="font-semibold">You are not logged in.</p>
            </DropdownItem>
            <DropdownItem key="login" color="danger">
              Log In
            </DropdownItem>
          </DropdownMenu>
        </Dropdown>
      </>
    );
  } else if (status === "authenticated") {
    return (
      <>
        <Dropdown placement="bottom-end">
          <DropdownTrigger>
            <Avatar
              isBordered
              as="button"
              className="transition-transform"
              color="secondary"
              name={session?.user?.name as string}
              size="sm"
              icon={<UserIconChecked />}
            />
          </DropdownTrigger>
          <DropdownMenu
            aria-label="Profile Actions"
            variant="flat"
            onAction={(key) => (key === "logout") ? void signOut() : alert(key)}
          >
            <DropdownItem key="profile" className="h-14 gap-2">
              <p className="font-semibold">Signed in as</p>
              <p className="font-semibold">{session?.user?.name}</p>
              <p className="font-semibold"> with email {session?.user?.email}</p>
            </DropdownItem>
            <DropdownItem key="settings">
              My Settings
            </DropdownItem>
            <DropdownItem key="team_settings">Team Settings</DropdownItem>
            <DropdownItem key="analytics">
              Analytics
            </DropdownItem>
            <DropdownItem key="system">System</DropdownItem>
            <DropdownItem key="configurations">Configurations</DropdownItem>
            <DropdownItem key="help_and_feedback">
              Help & Feedback
            </DropdownItem>
            <DropdownItem key="logout" color="danger">
              Log Out
            </DropdownItem>
          </DropdownMenu>
        </Dropdown>
      </>
    );
  } else {
    // Loading State
    return <Spinner label={"Loading..."} color={"primary"} labelColor="primary"/>;
  }
}