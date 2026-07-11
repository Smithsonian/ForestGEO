'use client';

import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormLabel,
  Input,
  Modal,
  ModalDialog,
  Option,
  Select,
  Stack,
  Table
} from '@mui/joy';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useIsMounted } from '@/app/hooks/useismounted';
import { AdminSiteRDS, AdminUserRDS } from '@/lib/db/definitions/admin';
import ailogger from '@/ailogger';

type UserWithSite = Omit<AdminUserRDS, 'userSites'> & { userSites: AdminSiteRDS[] };
type NewUserForm = Required<Pick<UserWithSite, 'firstName' | 'lastName' | 'email' | 'notifications' | 'userStatus'>>;

const EMPTY_NEW_USER: NewUserForm = { firstName: '', lastName: '', email: '', notifications: false, userStatus: 'field crew' };

export default function UserSettingsPage() {
  const [users, setUsers] = useState<UserWithSite[]>([]);
  const [baseUsers, setBaseUsers] = useState<UserWithSite[]>([]);
  const [_sites, setSites] = useState<AdminSiteRDS[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editingUserID, setEditingUserID] = useState<number | null>(null);
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [newUser, setNewUser] = useState<NewUserForm>(EMPTY_NEW_USER);
  const [addingUser, setAddingUser] = useState(false);

  // Track mounted state to prevent state updates after unmount
  const { isMountedRef } = useIsMounted();

  useEffect(() => {
    const controller = new AbortController();
    async function fetchUsers() {
      try {
        if (isMountedRef.current) {
          setLoading(true);
          setError(null);
        }

        const userResponse = await fetch(`/api/administrative/fetch/users`, { signal: controller.signal });
        if (!isMountedRef.current) return;

        if (!userResponse.ok) {
          throw new Error(`Failed to load users: ${userResponse.status} ${userResponse.statusText}`);
        }
        const tempUsers: AdminUserRDS[] = await userResponse.json();

        if (!isMountedRef.current) return;

        const sitesResponse = await fetch(`/api/administrative/fetch/sites`, { signal: controller.signal });
        if (!isMountedRef.current) return;

        if (!sitesResponse.ok) {
          throw new Error(`Failed to load sites: ${sitesResponse.status} ${sitesResponse.statusText}`);
        }
        const tempSites: AdminSiteRDS[] = await sitesResponse.json();

        if (!isMountedRef.current) return;

        setSites(tempSites);

        const siteMap: Record<number, AdminSiteRDS> = {};
        tempSites.forEach(site => (siteMap[site.siteID ?? 0] = site));

        const mappedUsers: UserWithSite[] = tempUsers.map(u => {
          const ids =
            u.userSites
              ?.split(';')
              .map(s => parseInt(s, 10))
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
        setBaseUsers(mappedUsers);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (!isMountedRef.current) return;
        const errorMessage = err instanceof Error ? err.message : 'Failed to load data. Please try again.';
        setError(errorMessage);
        ailogger.error('Failed to fetch users', err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    }

    void fetchUsers();
    return () => controller.abort();
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

  const safeJoin = useCallback(
    (arr?: { siteID?: number }[]) =>
      (arr ?? [])
        .map(s => s.siteID ?? -1)
        .sort((a, b) => a - b)
        .join(','),
    []
  );

  const isUserChanged = useCallback(
    (u: UserWithSite, b?: UserWithSite): boolean => {
      if (!b) return true;
      return (
        u.firstName !== b.firstName ||
        u.lastName !== b.lastName ||
        u.email !== b.email ||
        u.notifications !== b.notifications ||
        u.userStatus !== b.userStatus ||
        safeJoin(u.userSites) !== safeJoin(b.userSites)
      );
    },
    [safeJoin]
  );

  const baseUsersMap = useMemo(() => new Map(baseUsers.map(u => [u.userID, u])), [baseUsers]);

  const foundChanges = useMemo(() => {
    return users.some(u => isUserChanged(u, baseUsersMap.get(u.userID)));
  }, [users, baseUsersMap, isUserChanged]);

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', width: '100%', gap: 2 }}>
      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {error && (
        <Alert color="danger" variant="soft">
          {error}
        </Alert>
      )}

      {saveError && (
        <Alert color="danger" variant="soft">
          {saveError}
        </Alert>
      )}

      {!loading && !error && (
        <>
          <Stack direction={'row'} gap={1}>
            <Button
              onClick={() => {
                setSaveError(null);
                setNewUser(EMPTY_NEW_USER);
                setAddUserOpen(true);
              }}
            >
              Add user
            </Button>
            <Button disabled={!foundChanges} onClick={() => setUsers(baseUsers)}>
              Discard Changes
            </Button>
            <Button
              disabled={!foundChanges}
              onClick={async () => {
                try {
                  setSaveError(null);
                  const baseMap = new Map(baseUsers.map(u => [u.userID, u]));
                  const updates = await Promise.all(
                    users.map(async user => {
                      const oldUser = baseMap.get(user.userID);
                      if (JSON.stringify(user) !== JSON.stringify(oldUser)) {
                        const response = await fetch(`/api/administrative/fetch/users`, {
                          method: 'PATCH',
                          body: JSON.stringify({ newRow: user, oldRow: oldUser }),
                          headers: { 'Content-Type': 'application/json' }
                        });
                        if (!response.ok) {
                          throw new Error(`Failed to save changes: ${response.status} ${response.statusText}`);
                        }
                        return user;
                      }
                      return oldUser;
                    })
                  );
                  setBaseUsers(updates.filter((u): u is UserWithSite => !!u));
                } catch (err) {
                  const errorMessage = err instanceof Error ? err.message : 'Failed to save changes. Please try again.';
                  setSaveError(errorMessage);
                  ailogger.error('Failed to save user changes', err instanceof Error ? err : new Error(String(err)));
                }
              }}
            >
              Save Changes
            </Button>
          </Stack>
          <Table>
            <thead>
              <tr>
                <th id={'first-name'}>First Name</th>
                <th id={'last-name'}>Last Name</th>
                <th id={'email'}>Email</th>
                <th id={'notifications'}>Notifications</th>
                <th id={'user-status'}>User Status</th>
                <th>Actions</th>
                {/*<th>Sites</th>*/}
              </tr>
            </thead>
            <tbody>
              {(users as UserWithSite[]).map(u => (
                <tr
                  key={u.userID!}
                  data-dirty={isUserChanged(u, baseUsersMap.get(u.userID)) || undefined}
                  style={{ background: isUserChanged(u, baseUsersMap.get(u.userID)) ? 'var(--joy-palette-warning-softBg)' : undefined }}
                >
                  {(() => {
                    const editing = editingUserID === u.userID;
                    return (
                      <>
                        <td aria-labelledby={'first-name'}>
                          {editing ? (
                            <Input aria-label={'first name value'} name={'firstName'} value={u.firstName} onChange={e => onTextFieldChange(e, u)} />
                          ) : (
                            u.firstName
                          )}
                        </td>
                        <td aria-labelledby={'last-name'}>
                          {editing ? (
                            <Input aria-label={'last name value'} name={'lastName'} value={u.lastName} onChange={e => onTextFieldChange(e, u)} />
                          ) : (
                            u.lastName
                          )}
                        </td>
                        <td aria-labelledby={'email'}>
                          {editing ? <Input aria-label={'email value'} name={'email'} value={u.email} onChange={e => onTextFieldChange(e, u)} /> : u.email}
                        </td>
                        <td aria-labelledby={'notifications'}>
                          <Checkbox
                            aria-label={'notifications value'}
                            name="notifications"
                            checked={u.notifications ?? false}
                            onChange={e => onTextFieldChange(e, u)}
                            disabled={!editing}
                          />
                        </td>
                        <td aria-labelledby={'user-status'}>
                          <Select
                            aria-label={'user status value'}
                            name={'userStatus'}
                            value={u.userStatus}
                            disabled={!editing}
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
                        <td>
                          {isUserChanged(u, baseUsersMap.get(u.userID)) && (
                            <Chip size="sm" color="warning" sx={{ mr: 1 }}>
                              Unsaved
                            </Chip>
                          )}
                          <Button
                            size="sm"
                            variant="plain"
                            startDecorator={<EditOutlinedIcon />}
                            onClick={() => setEditingUserID(editing ? null : (u.userID ?? null))}
                          >
                            {editing ? 'Done' : 'Edit'}
                          </Button>
                        </td>
                      </>
                    );
                  })()}
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
          <Modal open={addUserOpen} onClose={() => (addingUser ? undefined : setAddUserOpen(false))}>
            <ModalDialog aria-labelledby="add-user-title" sx={{ width: 'min(480px, calc(100vw - 32px))' }}>
              <DialogTitle id="add-user-title">Add user</DialogTitle>
              <DialogContent>Enter the user’s directory details and initial application role.</DialogContent>
              <Stack spacing={1.5}>
                <FormControl required>
                  <FormLabel htmlFor="new-user-first-name">First name</FormLabel>
                  <Input
                    id="new-user-first-name"
                    aria-label="First name"
                    value={newUser.firstName}
                    onChange={event => setNewUser(user => ({ ...user, firstName: event.target.value }))}
                  />
                </FormControl>
                <FormControl required>
                  <FormLabel htmlFor="new-user-last-name">Last name</FormLabel>
                  <Input
                    id="new-user-last-name"
                    aria-label="Last name"
                    value={newUser.lastName}
                    onChange={event => setNewUser(user => ({ ...user, lastName: event.target.value }))}
                  />
                </FormControl>
                <FormControl required>
                  <FormLabel htmlFor="new-user-email">Email</FormLabel>
                  <Input
                    id="new-user-email"
                    aria-label="Email"
                    type="email"
                    value={newUser.email}
                    onChange={event => setNewUser(user => ({ ...user, email: event.target.value }))}
                  />
                </FormControl>
                <FormControl required>
                  <FormLabel htmlFor="new-user-role">Role</FormLabel>
                  <Select
                    id="new-user-role"
                    aria-label="Role"
                    value={newUser.userStatus}
                    onChange={(_event, value) => value && setNewUser(user => ({ ...user, userStatus: value }))}
                  >
                    <Option value="global">Global</Option>
                    <Option value="db admin">DB Admin</Option>
                    <Option value="lead technician">Lead Technician</Option>
                    <Option value="field crew">Field Crew</Option>
                  </Select>
                </FormControl>
                <Checkbox
                  aria-label="Receive notifications"
                  label="Receive notifications"
                  checked={newUser.notifications}
                  onChange={event => setNewUser(user => ({ ...user, notifications: event.target.checked }))}
                />
              </Stack>
              <DialogActions>
                <Button
                  loading={addingUser}
                  disabled={!newUser.firstName.trim() || !newUser.lastName.trim() || !newUser.email.trim()}
                  onClick={async () => {
                    setAddingUser(true);
                    setSaveError(null);
                    try {
                      const response = await fetch('/api/administrative/fetch/users', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ newRow: newUser })
                      });
                      const body = (await response.json().catch(() => ({}))) as { message?: string; userID?: number };
                      if (!response.ok || !Number.isInteger(body.userID) || Number(body.userID) <= 0) {
                        throw new Error(body.message || 'Failed to add user');
                      }
                      const created: UserWithSite = { ...newUser, userID: body.userID, userSites: [] };
                      setUsers(previous => [...previous, created]);
                      setBaseUsers(previous => [...previous, created]);
                      setEditingUserID(created.userID ?? null);
                      setAddUserOpen(false);
                    } catch (err) {
                      const message = err instanceof Error ? err.message : 'Failed to add user';
                      setSaveError(message);
                      ailogger.error('Failed to add user', err instanceof Error ? err : new Error(String(err)));
                    } finally {
                      setAddingUser(false);
                    }
                  }}
                >
                  Add user
                </Button>
                <Button variant="plain" disabled={addingUser} onClick={() => setAddUserOpen(false)}>
                  Cancel
                </Button>
              </DialogActions>
            </ModalDialog>
          </Modal>
        </>
      )}
    </Box>
  );
}
