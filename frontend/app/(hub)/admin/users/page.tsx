'use client';

import { Box, Button, Checkbox, Input, Option, Select, Stack, Table } from '@mui/joy';
import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { AdminSiteRDS, AdminUserRDS } from '@/config/sqlrdsdefinitions/admin';
import { v4 } from 'uuid';

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

      return tempUsers.map(u => {
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
    }

    fetchUsers()
      .then(out => setUsers(out))
      .then(() => {
        baseUsers.current = users;
      });
  }, []);

  useEffect(() => {
    if (users.length > 0 && baseUsers.current.length === 0) baseUsers.current = JSON.parse(JSON.stringify(users));
  }, [users]);

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

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', width: '100%' }}>
      <Stack direction={'row'} gap={1}>
        <Button disabled={JSON.stringify(users) === JSON.stringify(baseUsers.current)} onClick={() => setUsers(baseUsers.current)}>
          Discard Changes
        </Button>
        <Button
          disabled={JSON.stringify(users) === JSON.stringify(baseUsers.current)}
          onClick={async () => {
            users.map(async user => {
              if (JSON.stringify(user) !== JSON.stringify(baseUsers.current.find(i => i.userID === user.userID))) {
                // current !== baseline, update
                await fetch(`/api/administrative/fetch/users`, {
                  method: 'PATCH',
                  body: JSON.stringify({ newRow: user, oldRow: baseUsers.current.find(i => i.userID === user.userID) })
                });
              }
            });
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
            <th>Sites</th>
          </tr>
        </thead>
        <tbody>
          {users.map(u => (
            <tr key={v4()}>
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
                            : u
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
              <td>
                <Select
                  name={'userSites'}
                  multiple
                  value={u.userSites.map(s => s.siteID!)}
                  onChange={(_event, value) => {
                    const selectedSites = value.map(v => sites.find(s => s.siteID === v));
                    setUsers(prev => ({ ...prev, userSites: selectedSites }));
                  }}
                >
                  {sites.map(s => (
                    <Option key={s.siteID} value={s.siteID}>
                      {s.siteName}
                    </Option>
                  ))}
                </Select>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Box>
  );
}
