'use client';

import { Box, Button, Checkbox, Input, Option, Select, Stack, Table } from '@mui/joy';
import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { AdminSiteRDS, AdminUserRDS } from '@/config/sqlrdsdefinitions/admin';

type UserWithSite = Omit<AdminUserRDS, 'userSites'> & { userSites: AdminSiteRDS[] };

export default function UserSettingsPage() {
  const [users, setUsers] = useState<UserWithSite[]>([]);
  const baseUsers = useRef(users);
  const [sites, setSites] = useState<AdminSiteRDS[]>([]);

  useEffect(() => {
    async function fetchUsers() {
      const userResponse = await fetch(`/api/administrative/fetch/users`);
      const tempUsers: AdminUserRDS[] = await userResponse.json();
      const sitesResponse = await fetch(`/api/administrative/fetch/sites`);
      const tempSites: AdminSiteRDS[] = await sitesResponse.json();
      setSites(tempSites);

      const siteMap: Record<number, AdminSiteRDS> = {};
      tempSites.forEach(site => (siteMap[site.siteID ?? 0] = site));

      const mappedUsers: UserWithSite[] = tempUsers.map(u => {
        const ids =
          u.userSites
            ?.split(';')
            .map(s => parseInt(s))
            .filter(n => !isNaN(n)) ?? [];
        return {
          userID: u.userID,
          lastName: u.lastName,
          firstName: u.firstName,
          email: u.email,
          notifications: u.notifications,
          userStatus: u.userStatus,
          userSites: ids.map(i => siteMap[i]).filter(Boolean)
        };
      });

      setUsers(mappedUsers);
      baseUsers.current = mappedUsers;
    }

    fetchUsers().catch(console.error);
  }, []);

  function onTextFieldChange(e: ChangeEvent<HTMLInputElement>, uSite: UserWithSite) {
    setUsers(prev =>
      prev.map(u =>
        u.userID === uSite.userID
          ? {
              ...u,
              [e.target.name as keyof UserWithSite]: e.target.type === 'checkbox' ? e.target.checked : e.target.value
            }
          : u
      )
    );
  }

  const safeJoin = (arr?: { siteID?: number }[]) =>
    (arr ?? [])
      .map(s => s.siteID ?? -1)
      .sort((a, b) => a - b)
      .join(',');

  function isUserChanged(u: UserWithSite, b?: UserWithSite): boolean {
    if (!b) return true;
    return (
      u.firstName !== b.firstName ||
      u.lastName !== b.lastName ||
      u.email !== b.email ||
      u.notifications !== b.notifications ||
      u.userStatus !== b.userStatus ||
      safeJoin(u.userSites) !== safeJoin(b.userSites)
    );
  }

  const baseUsersMap = useMemo(() => new Map(baseUsers.current.map(u => [u.userID, u])), [users]);

  const foundChanges = useMemo(() => {
    return users.some(u => isUserChanged(u, baseUsersMap.get(u.userID)));
  }, [users]);

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', width: '100%' }}>
      <Stack direction={'row'} gap={1}>
        <Button disabled={!foundChanges} onClick={() => setUsers(baseUsers.current)}>
          Discard Changes
        </Button>
        <Button
          disabled={!foundChanges}
          onClick={async () => {
            const baseMap = new Map(baseUsers.current.map(u => [u.userID, u]));
            const updates = await Promise.all(
              users.map(async user => {
                const oldUser = baseMap.get(user.userID);
                if (JSON.stringify(user) !== JSON.stringify(oldUser)) {
                  await fetch(`/api/administrative/fetch/users`, {
                    method: 'PATCH',
                    body: JSON.stringify({ newRow: user, oldRow: oldUser }),
                    headers: { 'Content-Type': 'application/json' }
                  });
                  return user;
                }
                return oldUser;
              })
            );
            baseUsers.current = updates.filter((u): u is UserWithSite => !!u);
          }}
        >
          Save Changes
        </Button>
      </Stack>
      <Table>
        <thead>
          <tr>
            <th>First Name</th>
            <th>Last Name</th>
            <th>Email</th>
            <th>Notifications</th>
            <th>User Status</th>
            {/*<th>Sites</th>*/}
          </tr>
        </thead>
        <tbody>
          {(users as UserWithSite[]).map(u => (
            <tr key={u.userID!}>
              <td>
                <Input name={'firstName'} value={u.firstName} onChange={e => onTextFieldChange(e, u)} />
              </td>
              <td>
                <Input name={'lastName'} value={u.lastName} onChange={e => onTextFieldChange(e, u)} />
              </td>
              <td>
                <Input name={'email'} value={u.email} onChange={e => onTextFieldChange(e, u)} />
              </td>
              <td>
                <Checkbox name="notifications" checked={u.notifications ?? false} onChange={e => onTextFieldChange(e, u)} />
              </td>
              <td>
                <Select
                  name={'userStatus'}
                  value={u.userStatus}
                  onChange={(_event, newValue) => {
                    if (newValue) {
                      setUsers(prev =>
                        prev.map(i =>
                          i.userID === u.userID
                            ? {
                                ...i,
                                userStatus: newValue
                              }
                            : i
                        )
                      );
                    }
                  }}
                >
                  <Option value={'global'}>Global</Option>
                  <Option value={'db admin'}>DB Admin</Option>
                  <Option value={'lead technician'}>Lead Technician</Option>
                  <Option value={'field crew'}>Field Crew</Option>
                </Select>
              </td>
              {/*<td>*/}
              {/*  <Select*/}
              {/*    name={'userSites'}*/}
              {/*    multiple*/}
              {/*    value={u.userSites.map(s => s.siteID!)}*/}
              {/*    onChange={(_event, value) => {*/}
              {/*      const selectedSites = value.map(v => sites.find(s => s.siteID === v));*/}
              {/*      setUsers(prev =>*/}
              {/*        prev.map(i =>*/}
              {/*          i.userID === u.userID*/}
              {/*            ? {*/}
              {/*                ...i,*/}
              {/*                userSites: selectedSites.filter((s): s is AdminSiteRDS => !!s)*/}
              {/*              }*/}
              {/*            : i*/}
              {/*        )*/}
              {/*      );*/}
              {/*    }}*/}
              {/*  >*/}
              {/*    {sites.map(s => (*/}
              {/*      <Option key={s.siteID} value={s.siteID}>*/}
              {/*        {s.siteName}*/}
              {/*      </Option>*/}
              {/*    ))}*/}
              {/*  </Select>*/}
              {/*</td>*/}
            </tr>
          ))}
        </tbody>
      </Table>
    </Box>
  );
}
