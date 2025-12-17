// userstosites.tsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useIsMounted } from '@/app/hooks/useismounted';
import { AdminSiteRDS, AdminUserRDS } from '@/config/sqlrdsdefinitions/admin';
import {
  Autocomplete,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Input,
  Modal,
  ModalClose,
  ModalDialog,
  Snackbar,
  Stack,
  ToggleButtonGroup,
  Tooltip,
  Typography
} from '@mui/joy';
import { Add, Check, Close, ExpandMore, FilterList, Forest, Landscape, Park, Public, Refresh, Search, Undo } from '@mui/icons-material';
import ailogger from '@/ailogger';

interface UserSiteRelation {
  userID: number;
  userName: string;
  siteID: number;
  siteName: string;
}

interface UserWithSites extends AdminUserRDS {
  assignedSiteIds: Set<number>;
}

// Status badge colors
const statusColors: Record<string, 'success' | 'primary' | 'warning' | 'neutral' | 'danger'> = {
  global: 'success',
  'db admin': 'primary',
  'lead technician': 'warning',
  'field crew': 'neutral',
  pending: 'danger'
};

// Status display names
const statusLabels: Record<string, string> = {
  global: 'Global',
  'db admin': 'DB Admin',
  'lead technician': 'Lead Tech',
  'field crew': 'Field Crew',
  pending: 'Pending'
};

// Site icons for visual variety (cycles through these)
const siteIcons = [Forest, Park, Landscape, Public];

// Site color palette for visual distinction
const siteColorPalette: Array<{ bg: string; hoverBg: string; text: string }> = [
  { bg: '#3b82f6', hoverBg: '#2563eb', text: 'white' }, // Blue
  { bg: '#10b981', hoverBg: '#059669', text: 'white' }, // Emerald
  { bg: '#8b5cf6', hoverBg: '#7c3aed', text: 'white' }, // Violet
  { bg: '#f59e0b', hoverBg: '#d97706', text: 'white' }, // Amber
  { bg: '#6366f1', hoverBg: '#4f46e5', text: 'white' }, // Indigo
  { bg: '#ec4899', hoverBg: '#db2777', text: 'white' }, // Pink
  { bg: '#14b8a6', hoverBg: '#0d9488', text: 'white' }, // Teal
  { bg: '#f97316', hoverBg: '#ea580c', text: 'white' } // Orange
];

// Maximum sites to show before collapsing
const MAX_VISIBLE_SITES = 4;

export default function UsersToSitesPage() {
  // Data state
  const [users, setUsers] = useState<AdminUserRDS[]>([]);
  const [sites, setSites] = useState<AdminSiteRDS[]>([]);
  const [userSiteRelations, setUserSiteRelations] = useState<UserSiteRelation[]>([]);
  const [originalRelations, setOriginalRelations] = useState<UserSiteRelation[]>([]);

  // UI state
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [expandedUsers, setExpandedUsers] = useState<Set<number>>(new Set());
  const [detailModalUser, setDetailModalUser] = useState<UserWithSites | null>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; color: 'success' | 'danger' | 'warning' }>({
    open: false,
    message: '',
    color: 'success'
  });

  // Create a stable color mapping for sites
  const siteColorMap = useMemo(() => {
    const map: Record<number, number> = {};
    sites.forEach((site, index) => {
      map[site.siteID ?? 0] = index % siteColorPalette.length;
    });
    return map;
  }, [sites]);

  // Track mounted state to prevent state updates after unmount
  const { isMountedRef } = useIsMounted();

  // Fetch initial data
  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const [usersRes, sitesRes, relationsRes] = await Promise.all([
          fetch('/api/administrative/fetch/users'),
          fetch('/api/administrative/fetch/sites'),
          fetch('/api/administrative/fetch/usersiterelations')
        ]);

        if (!isMountedRef.current) return;

        if (!usersRes.ok || !sitesRes.ok || !relationsRes.ok) {
          throw new Error('Failed to fetch data');
        }

        const usersData = await usersRes.json();
        const sitesData = await sitesRes.json();
        const relationsData = await relationsRes.json();

        if (isMountedRef.current) {
          setUsers(usersData);
          setSites(sitesData);
          setUserSiteRelations(relationsData);
          setOriginalRelations(relationsData);
        }
      } catch (error) {
        ailogger.error('Failed to fetch user-site data:', error instanceof Error ? error : new Error(String(error)));
        if (isMountedRef.current) {
          setSnackbar({ open: true, message: 'Failed to load data', color: 'danger' });
        }
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    }
    fetchData();
  }, []);

  // Build user-to-sites mapping
  const usersWithSites = useMemo((): UserWithSites[] => {
    const sitesByUser = userSiteRelations.reduce<Record<number, Set<number>>>((acc, rel) => {
      if (!acc[rel.userID]) acc[rel.userID] = new Set();
      acc[rel.userID].add(rel.siteID);
      return acc;
    }, {});

    return users.map(user => ({
      ...user,
      assignedSiteIds: sitesByUser[user.userID ?? 0] ?? new Set()
    }));
  }, [users, userSiteRelations]);

  // Filter users based on search and status
  const filteredUsers = useMemo(() => {
    return usersWithSites.filter(user => {
      const matchesSearch =
        searchQuery === '' ||
        `${user.firstName} ${user.lastName}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
        user.email?.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesStatus = !statusFilter || user.userStatus === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [usersWithSites, searchQuery, statusFilter]);

  // Check if there are pending changes
  const hasChanges = useMemo(() => {
    const currentSet = new Set(userSiteRelations.map(r => `${r.userID}-${r.siteID}`));
    const originalSet = new Set(originalRelations.map(r => `${r.userID}-${r.siteID}`));

    if (currentSet.size !== originalSet.size) return true;
    for (const item of currentSet) {
      if (!originalSet.has(item)) return true;
    }
    return false;
  }, [userSiteRelations, originalRelations]);

  // Count changes per user
  const changesPerUser = useMemo(() => {
    const changes: Record<number, { added: number; removed: number }> = {};
    const originalByUser = originalRelations.reduce<Record<number, Set<number>>>((acc, rel) => {
      if (!acc[rel.userID]) acc[rel.userID] = new Set();
      acc[rel.userID].add(rel.siteID);
      return acc;
    }, {});

    usersWithSites.forEach(user => {
      const originalSites = originalByUser[user.userID ?? 0] ?? new Set();
      const currentSites = user.assignedSiteIds;

      let added = 0;
      let removed = 0;

      currentSites.forEach(siteId => {
        if (!originalSites.has(siteId)) added++;
      });
      originalSites.forEach(siteId => {
        if (!currentSites.has(siteId)) removed++;
      });

      if (added > 0 || removed > 0) {
        changes[user.userID ?? 0] = { added, removed };
      }
    });

    return changes;
  }, [usersWithSites, originalRelations]);

  // Add site to user
  const handleAddSite = useCallback(
    (userId: number, siteId: number, siteName: string) => {
      const user = users.find(u => u.userID === userId);
      if (!user) return;

      const userName = `${user.firstName} ${user.lastName}`;
      setUserSiteRelations(prev => [...prev, { userID: userId, userName, siteID: siteId, siteName }]);
    },
    [users]
  );

  // Remove site from user
  const handleRemoveSite = useCallback((userId: number, siteId: number) => {
    setUserSiteRelations(prev => prev.filter(rel => !(rel.userID === userId && rel.siteID === siteId)));
  }, []);

  // Toggle user expansion
  const toggleUserExpansion = useCallback((userId: number) => {
    setExpandedUsers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(userId)) {
        newSet.delete(userId);
      } else {
        newSet.add(userId);
      }
      return newSet;
    });
  }, []);

  // Discard all changes
  const handleDiscard = useCallback(() => {
    setUserSiteRelations(originalRelations);
    setSnackbar({ open: true, message: 'Changes discarded', color: 'warning' });
  }, [originalRelations]);

  // Save changes to API
  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const originalByUser = originalRelations.reduce<Record<number, Set<number>>>((acc, rel) => {
        if (!acc[rel.userID]) acc[rel.userID] = new Set();
        acc[rel.userID].add(rel.siteID);
        return acc;
      }, {});

      const currentByUser = userSiteRelations.reduce<Record<number, Set<number>>>((acc, rel) => {
        if (!acc[rel.userID]) acc[rel.userID] = new Set();
        acc[rel.userID].add(rel.siteID);
        return acc;
      }, {});

      const allUserIds = new Set([...Object.keys(originalByUser).map(Number), ...Object.keys(currentByUser).map(Number)]);

      const updatePromises: Promise<Response>[] = [];

      for (const userId of allUserIds) {
        const originalSites = originalByUser[userId] ?? new Set();
        const currentSites = currentByUser[userId] ?? new Set();

        const hasUserChanges =
          originalSites.size !== currentSites.size || [...originalSites].some(s => !currentSites.has(s)) || [...currentSites].some(s => !originalSites.has(s));

        if (hasUserChanges) {
          const user = users.find(u => u.userID === userId);
          if (!user) continue;

          const oldRow = {
            ...user,
            userSites: [...originalSites].map(siteId => ({ siteID: siteId }))
          };
          const newRow = {
            ...user,
            userSites: [...currentSites].map(siteId => ({ siteID: siteId }))
          };

          updatePromises.push(
            fetch('/api/administrative/fetch/users', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ oldRow, newRow })
            })
          );
        }
      }

      const results = await Promise.all(updatePromises);
      const allSuccessful = results.every(r => r.ok);

      if (allSuccessful) {
        setOriginalRelations([...userSiteRelations]);
        setSnackbar({ open: true, message: `Successfully saved ${updatePromises.length} user(s)!`, color: 'success' });
      } else {
        throw new Error('Some updates failed');
      }
    } catch (error) {
      ailogger.error('Failed to save changes:', error instanceof Error ? error : new Error(String(error)));
      setSnackbar({ open: true, message: 'Failed to save changes', color: 'danger' });
    } finally {
      setSaving(false);
    }
  }, [userSiteRelations, originalRelations, users]);

  // Get available sites for a user
  const getAvailableSites = useCallback(
    (userId: number) => {
      const assigned = usersWithSites.find(u => u.userID === userId)?.assignedSiteIds ?? new Set();
      return sites.filter(site => !assigned.has(site.siteID ?? 0));
    },
    [usersWithSites, sites]
  );

  // Get initials from name
  const getInitials = (firstName?: string, lastName?: string) => {
    return `${firstName?.charAt(0) ?? ''}${lastName?.charAt(0) ?? ''}`.toUpperCase();
  };

  // Render a site chip with improved styling
  const renderSiteChip = (site: AdminSiteRDS, userId: number, userName: string, size: 'sm' | 'md' = 'md') => {
    const colorIndex = siteColorMap[site.siteID ?? 0] ?? 0;
    const colors = siteColorPalette[colorIndex];
    const IconComponent = siteIcons[colorIndex % siteIcons.length];

    return (
      <Chip
        key={site.siteID}
        size={size}
        variant="solid"
        startDecorator={<IconComponent sx={{ fontSize: size === 'sm' ? 12 : 14 }} />}
        endDecorator={
          <IconButton
            size="sm"
            variant="plain"
            color="neutral"
            onClick={e => {
              e.stopPropagation();
              handleRemoveSite(userId, site.siteID ?? 0);
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                handleRemoveSite(userId, site.siteID ?? 0);
              }
            }}
            aria-label={`Remove ${site.siteName} from ${userName}`}
            sx={{
              '--IconButton-size': size === 'sm' ? '16px' : '20px',
              minWidth: 'unset',
              minHeight: 'unset',
              borderRadius: '50%',
              ml: 0.5,
              color: 'inherit',
              opacity: 0.7,
              '&:hover': {
                opacity: 1,
                backgroundColor: 'rgba(0,0,0,0.12)'
              }
            }}
          >
            <Close sx={{ fontSize: size === 'sm' ? 12 : 14 }} />
          </IconButton>
        }
        sx={{
          backgroundColor: colors.bg,
          color: colors.text,
          py: size === 'sm' ? 0.5 : 0.75,
          px: size === 'sm' ? 1 : 1.5,
          borderRadius: 'lg',
          fontWeight: 600,
          fontSize: size === 'sm' ? '0.75rem' : '0.8rem',
          letterSpacing: '0.01em',
          transition: 'background-color 0.15s ease',
          '&:hover': {
            backgroundColor: colors.hoverBg
          }
        }}
      >
        {site.siteName}
      </Chip>
    );
  };

  // Loading state
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh', flexDirection: 'column', gap: 2 }}>
        <CircularProgress size="lg" />
        <Typography level="body-md" sx={{ color: 'neutral.500' }}>
          Loading user-site assignments...
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: { xs: 1, sm: 1.5, md: 2 }, width: '100%' }}>
      {/* Compact Action Bar */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 1.5,
          py: 1,
          px: 1.5,
          bgcolor: 'background.level1',
          borderRadius: 'lg',
          border: '1px solid',
          borderColor: 'divider'
        }}
      >
        <Typography level="body-sm" sx={{ color: 'neutral.600', display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          {users.length} users · {sites.length} sites · {userSiteRelations.length} assignments
          {hasChanges && (
            <Chip size="sm" color="warning" variant="soft" sx={{ fontWeight: 600, ml: 1 }}>
              Unsaved
            </Chip>
          )}
        </Typography>

        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
          <Button variant="outlined" color="neutral" startDecorator={<Refresh />} onClick={() => window.location.reload()} size="sm">
            Refresh
          </Button>
          <Button variant="soft" color="warning" startDecorator={<Undo />} disabled={!hasChanges} onClick={handleDiscard} size="sm">
            Discard
          </Button>
          <Button
            variant="solid"
            color="success"
            startDecorator={saving ? <CircularProgress size="sm" color="neutral" /> : <Check />}
            disabled={!hasChanges || saving}
            onClick={handleSave}
            size="sm"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </Stack>
      </Box>

      {/* Filters - Compact Inline */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          gap: 1.5,
          alignItems: { xs: 'stretch', md: 'center' },
          py: 1,
          px: 1.5,
          bgcolor: 'background.surface',
          borderRadius: 'lg',
          border: '1px solid',
          borderColor: 'divider'
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: { md: '0 0 280px' } }}>
          <Search sx={{ color: 'neutral.500', fontSize: 20 }} />
          <Input
            placeholder="Search by name or email..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            aria-label="Search users by name or email"
            size="sm"
            variant="plain"
            sx={{ flex: 1, '--Input-focusedThickness': '0px' }}
          />
        </Box>

        <Divider orientation="vertical" sx={{ display: { xs: 'none', md: 'block' }, height: 24 }} />

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <FilterList sx={{ color: 'neutral.500', fontSize: 18 }} />
            <Typography level="body-xs" sx={{ color: 'neutral.500', whiteSpace: 'nowrap' }}>
              Filter by role:
            </Typography>
          </Box>

          <ToggleButtonGroup value={statusFilter} onChange={(_e, newValue) => setStatusFilter(newValue)} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
            {Object.entries(statusLabels).map(([value, label]) => (
              <Button
                key={value}
                value={value}
                variant={statusFilter === value ? 'solid' : 'soft'}
                color={statusColors[value]}
                size="sm"
                sx={{ borderRadius: 'md', fontWeight: 500, py: 0.25, px: 1, fontSize: '0.75rem' }}
              >
                {label}
              </Button>
            ))}
          </ToggleButtonGroup>
        </Box>
      </Box>

      {/* User Cards Grid - Responsive */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(2, 1fr)',
            lg: 'repeat(3, 1fr)',
            xl: 'repeat(4, 1fr)'
          },
          gap: 2
        }}
      >
        {filteredUsers.map(user => {
          const userChanges = changesPerUser[user.userID ?? 0];
          const availableSites = getAvailableSites(user.userID ?? 0);
          const assignedSites = sites.filter(s => user.assignedSiteIds.has(s.siteID ?? 0));
          const isExpanded = expandedUsers.has(user.userID ?? 0);
          const hasMoreSites = assignedSites.length > MAX_VISIBLE_SITES;
          const visibleSites = isExpanded ? assignedSites : assignedSites.slice(0, MAX_VISIBLE_SITES);
          const hiddenCount = assignedSites.length - MAX_VISIBLE_SITES;
          const userName = `${user.firstName} ${user.lastName}`;

          return (
            <Card
              key={user.userID}
              variant="outlined"
              sx={{
                transition: 'box-shadow 0.2s ease',
                borderColor: userChanges ? 'warning.300' : 'neutral.200',
                borderRadius: 'lg',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                '&:hover': {
                  boxShadow: 'md'
                }
              }}
            >
              {/* Change indicator bar */}
              {userChanges && (
                <Box
                  sx={{
                    height: 3,
                    backgroundColor: 'warning.400'
                  }}
                />
              )}

              <CardContent sx={{ p: 2, flex: 1, display: 'flex', flexDirection: 'column' }}>
                {/* User Header */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
                  <Avatar
                    size="md"
                    color={statusColors[user.userStatus ?? 'neutral']}
                    alt={userName}
                    sx={{ fontSize: '0.9rem', fontWeight: 700, width: 40, height: 40 }}
                  >
                    {getInitials(user.firstName, user.lastName)}
                  </Avatar>

                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography level="title-md" sx={{ fontWeight: 600, lineHeight: 1.2, fontSize: '0.95rem' }}>
                      {userName}
                    </Typography>
                    <Tooltip title={user.email} placement="top" arrow variant="outlined">
                      <Typography
                        level="body-xs"
                        sx={{
                          color: 'neutral.400',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          cursor: 'help',
                          maxWidth: '100%',
                          fontSize: '0.75rem'
                        }}
                      >
                        {user.email}
                      </Typography>
                    </Tooltip>
                  </Box>

                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
                    <Chip size="sm" variant="soft" color={statusColors[user.userStatus ?? 'neutral']} sx={{ fontWeight: 600, fontSize: '0.7rem', height: 22 }}>
                      {statusLabels[user.userStatus ?? ''] ?? user.userStatus}
                    </Chip>
                    <IconButton variant="plain" color="neutral" size="sm" onClick={() => setDetailModalUser(user)} aria-label={`View details for ${userName}`}>
                      <ExpandMore sx={{ fontSize: 20 }} />
                    </IconButton>
                  </Box>
                </Box>

                <Divider sx={{ mb: 1.5 }} />

                {/* Assigned Sites */}
                <Typography
                  component="div"
                  level="body-xs"
                  sx={{ color: 'neutral.400', fontWeight: 500, mb: 0.75, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}
                >
                  Sites ({assignedSites.length})
                </Typography>

                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 1.5 }}>
                  {assignedSites.length === 0 ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', py: 2 }}>
                      <Typography level="body-sm" sx={{ color: 'neutral.400', fontStyle: 'italic' }}>
                        No sites assigned yet
                      </Typography>
                    </Box>
                  ) : (
                    <>
                      {visibleSites.map(site => renderSiteChip(site, user.userID ?? 0, userName, 'sm'))}

                      {hasMoreSites && !isExpanded && (
                        <Chip
                          size="sm"
                          variant="solid"
                          startDecorator={<ExpandMore sx={{ fontSize: 12 }} />}
                          endDecorator={
                            <IconButton
                              size="sm"
                              variant="plain"
                              color="neutral"
                              onClick={() => toggleUserExpansion(user.userID ?? 0)}
                              onKeyDown={e => {
                                if (e.key === 'Enter' || e.key === ' ') toggleUserExpansion(user.userID ?? 0);
                              }}
                              aria-label={`Show ${hiddenCount} more sites`}
                              sx={{
                                '--IconButton-size': '16px',
                                minWidth: 'unset',
                                minHeight: 'unset',
                                borderRadius: '50%',
                                ml: 0.5,
                                color: 'inherit',
                                opacity: 0.7,
                                '&:hover': {
                                  opacity: 1,
                                  backgroundColor: 'rgba(255,255,255,0.15)'
                                }
                              }}
                            >
                              <Add sx={{ fontSize: 12 }} />
                            </IconButton>
                          }
                          sx={{
                            backgroundColor: 'neutral.600',
                            color: 'white',
                            py: 0.5,
                            px: 1,
                            borderRadius: 'lg',
                            fontWeight: 600,
                            fontSize: '0.75rem',
                            letterSpacing: '0.01em',
                            transition: 'background-color 0.15s ease',
                            '&:hover': { backgroundColor: 'neutral.700' }
                          }}
                        >
                          +{hiddenCount}
                        </Chip>
                      )}

                      {hasMoreSites && isExpanded && (
                        <Chip
                          size="sm"
                          variant="solid"
                          startDecorator={<Close sx={{ fontSize: 12 }} />}
                          endDecorator={
                            <IconButton
                              size="sm"
                              variant="plain"
                              color="neutral"
                              onClick={() => toggleUserExpansion(user.userID ?? 0)}
                              onKeyDown={e => {
                                if (e.key === 'Enter' || e.key === ' ') toggleUserExpansion(user.userID ?? 0);
                              }}
                              aria-label="Show fewer sites"
                              sx={{
                                '--IconButton-size': '16px',
                                minWidth: 'unset',
                                minHeight: 'unset',
                                borderRadius: '50%',
                                ml: 0.5,
                                color: 'inherit',
                                opacity: 0.7,
                                '&:hover': {
                                  opacity: 1,
                                  backgroundColor: 'rgba(255,255,255,0.15)'
                                }
                              }}
                            >
                              <Close sx={{ fontSize: 12 }} />
                            </IconButton>
                          }
                          sx={{
                            backgroundColor: 'neutral.600',
                            color: 'white',
                            py: 0.5,
                            px: 1,
                            borderRadius: 'lg',
                            fontWeight: 600,
                            fontSize: '0.75rem',
                            letterSpacing: '0.01em',
                            transition: 'background-color 0.15s ease',
                            '&:hover': { backgroundColor: 'neutral.700' }
                          }}
                        >
                          Less
                        </Chip>
                      )}
                    </>
                  )}
                </Box>

                {/* Add Site Autocomplete */}
                <Box sx={{ mt: 'auto' }}>
                  {availableSites.length > 0 && (
                    <Autocomplete
                      size="sm"
                      placeholder="Add a site..."
                      options={availableSites}
                      getOptionLabel={option => option.siteName ?? ''}
                      startDecorator={<Add sx={{ color: 'primary.500' }} />}
                      onChange={(_e, site) => {
                        if (site) {
                          handleAddSite(user.userID ?? 0, site.siteID ?? 0, site.siteName ?? '');
                        }
                      }}
                      value={null}
                      blurOnSelect
                      slotProps={{
                        input: {
                          'aria-label': `Add site to ${userName}`
                        }
                      }}
                      sx={{
                        borderRadius: 'lg',
                        '& .MuiAutocomplete-input': {
                          fontSize: '0.875rem'
                        }
                      }}
                    />
                  )}

                  {availableSites.length === 0 && assignedSites.length > 0 && (
                    <Typography level="body-xs" sx={{ color: 'success.600', fontWeight: 600, textAlign: 'center', py: 0.75 }}>
                      ✓ Access to all sites
                    </Typography>
                  )}
                </Box>
              </CardContent>
            </Card>
          );
        })}
      </Box>

      {/* Empty State */}
      {filteredUsers.length === 0 && (
        <Card variant="soft" sx={{ textAlign: 'center', py: 8, borderRadius: 'xl' }}>
          <Typography level="h4" sx={{ color: 'neutral.500', mb: 1 }}>
            No users found
          </Typography>
          <Typography level="body-md" sx={{ color: 'neutral.400' }}>
            Try adjusting your search or filter criteria
          </Typography>
          {(searchQuery || statusFilter) && (
            <Button
              variant="soft"
              color="neutral"
              onClick={() => {
                setSearchQuery('');
                setStatusFilter(null);
              }}
              sx={{ mt: 2 }}
            >
              Clear all filters
            </Button>
          )}
        </Card>
      )}

      {/* Detail Modal */}
      <Modal open={!!detailModalUser} onClose={() => setDetailModalUser(null)}>
        <ModalDialog size="lg" sx={{ maxWidth: 600, borderRadius: 'xl', p: 0, overflow: 'hidden' }}>
          <ModalClose sx={{ m: 1.5, zIndex: 1 }} />

          {detailModalUser && (
            <>
              {/* Modal Header */}
              <Box sx={{ p: 3, pb: 2, backgroundColor: 'background.level1' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5 }}>
                  <Avatar
                    size="lg"
                    color={statusColors[detailModalUser.userStatus ?? 'neutral']}
                    alt={`${detailModalUser.firstName} ${detailModalUser.lastName}`}
                    sx={{ width: 64, height: 64, fontSize: '1.25rem', fontWeight: 700 }}
                  >
                    {getInitials(detailModalUser.firstName, detailModalUser.lastName)}
                  </Avatar>
                  <Box>
                    <Typography level="h3">
                      {detailModalUser.firstName} {detailModalUser.lastName}
                    </Typography>
                    <Typography level="body-md" sx={{ color: 'neutral.500' }}>
                      {detailModalUser.email}
                    </Typography>
                    <Chip size="sm" variant="soft" color={statusColors[detailModalUser.userStatus ?? 'neutral']} sx={{ mt: 1, fontWeight: 600 }}>
                      {statusLabels[detailModalUser.userStatus ?? ''] ?? detailModalUser.userStatus}
                    </Chip>
                  </Box>
                </Box>
              </Box>

              <Divider />

              {/* Modal Body */}
              <Box sx={{ p: 3 }}>
                <Typography level="title-md" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Forest sx={{ color: 'success.500' }} /> Assigned Sites ({sites.filter(s => detailModalUser.assignedSiteIds.has(s.siteID ?? 0)).length})
                </Typography>

                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mb: 3 }}>
                  {sites
                    .filter(s => detailModalUser.assignedSiteIds.has(s.siteID ?? 0))
                    .map(site => renderSiteChip(site, detailModalUser.userID ?? 0, `${detailModalUser.firstName} ${detailModalUser.lastName}`, 'md'))}

                  {detailModalUser.assignedSiteIds.size === 0 && (
                    <Typography level="body-md" sx={{ color: 'neutral.400', fontStyle: 'italic' }}>
                      No sites assigned
                    </Typography>
                  )}
                </Box>

                {getAvailableSites(detailModalUser.userID ?? 0).length > 0 && (
                  <>
                    <Divider sx={{ my: 2.5 }} />
                    <Typography level="title-sm" sx={{ mb: 1.5, color: 'neutral.600' }}>
                      Add Sites
                    </Typography>
                    <Autocomplete
                      placeholder="Search and add a site..."
                      options={getAvailableSites(detailModalUser.userID ?? 0)}
                      getOptionLabel={option => option.siteName ?? ''}
                      startDecorator={<Add />}
                      onChange={(_e, site) => {
                        if (site) {
                          handleAddSite(detailModalUser.userID ?? 0, site.siteID ?? 0, site.siteName ?? '');
                        }
                      }}
                      value={null}
                      blurOnSelect
                      slotProps={{
                        input: {
                          'aria-label': `Add site to ${detailModalUser.firstName} ${detailModalUser.lastName}`
                        }
                      }}
                      sx={{ borderRadius: 'lg' }}
                    />
                  </>
                )}
              </Box>
            </>
          )}
        </ModalDialog>
      </Modal>

      {/* Snackbar for feedback */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
        color={snackbar.color}
        variant="soft"
        size="lg"
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        sx={{ borderRadius: 'xl' }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {snackbar.color === 'success' && <Check />}
          {snackbar.color === 'danger' && <Close />}
          {snackbar.color === 'warning' && <Undo />}
          <Typography level="body-md" sx={{ fontWeight: 500 }}>
            {snackbar.message}
          </Typography>
        </Box>
      </Snackbar>
    </Box>
  );
}
