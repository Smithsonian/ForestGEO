// userstosites.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AdminSiteRDS, AdminUserRDS } from '@/config/sqlrdsdefinitions/admin';
import { Box, Button, Chip, Stack, Tab, TabList, TabPanel, Tabs } from '@mui/joy';
import ailogger from '@/ailogger';

interface UserSiteRelation {
  userID: number;
  userName: string;
  siteID: number;
  siteName: string;
}

export default function UsersToSitesPage() {
  const [userSites, setUserSites] = useState<UserSiteRelation[]>([]);
  const [users, setUsers] = useState<AdminUserRDS[]>([]);
  const [sites, setSites] = useState<AdminSiteRDS[]>([]);
  const [selectedUser, setSelectedUser] = useState<number>(0);
  const baseUserSites = useRef(userSites);

  useEffect(() => {
    async function fetchUserSites() {
      const usResponse = await (await fetch(`/api/administrative/fetch/usersiterelations`)).json();
      const userResponse = await (await fetch(`/api/administrative/fetch/users`)).json();
      const siteResponse = await (await fetch(`/api/administrative/fetch/sites`)).json();

      setSelectedUser(
        usResponse.reduce((minSoFar: UserSiteRelation, candidate: UserSiteRelation) => (candidate.userID < minSoFar.userID ? candidate : minSoFar))
      );
      setUserSites(usResponse);
      baseUserSites.current = usResponse;
      setUsers(userResponse);
      setSites(siteResponse);
    }

    fetchUserSites().catch(ailogger.error);
  }, []);

  const siteIdsByUser = useMemo(
    () =>
      userSites.reduce<Record<number, Set<number>>>((acc, { userID, siteID }) => {
        if (!acc[userID]) acc[userID] = new Set();
        acc[userID].add(siteID);
        return acc;
      }, {}),
    [userSites]
  );

  if (users.length === 0 || sites.length === 0 || userSites.length === 0) return <div>Loading...</div>;
  else
    return (
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', width: '100%' }}>
        <Stack direction={'row'} spacing={1} sx={{ marginBottom: 2 }}>
          <Button>Discard Changes</Button>
          <Button>Save Changes</Button>
        </Stack>
        <Tabs
          orientation={'vertical'}
          value={selectedUser}
          onChange={(_e, v) => (selectedUser === Number(v) ? setSelectedUser(0) : setSelectedUser(Number(v)))}
        >
          <TabList>
            {users.map((user, index) => (
              <Tab key={(user.userID ?? 0) + index} value={user.userID}>
                {user.firstName + ' ' + user.lastName}
              </Tab>
            ))}
          </TabList>
          {users.map((user, index) => (
            <TabPanel key={(user.userID ?? 0) + index} value={user.userID}>
              <Stack direction={'column'}>
                {sites.map(site => (
                  <Chip key={site.siteID} color={(siteIdsByUser[user.userID ?? 0] ?? new Set()).has(site.siteID ?? 0) ? 'primary' : 'neutral'}>
                    {site.siteName}
                  </Chip>
                ))}
              </Stack>
            </TabPanel>
          ))}
        </Tabs>
      </Box>
    );
}
