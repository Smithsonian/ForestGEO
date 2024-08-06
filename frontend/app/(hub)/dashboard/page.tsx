'use client';

import { Box, Card, CardContent, Chip, Divider, List, ListItem, ListItemContent, ListSubheader, Stack, Tooltip, Typography } from '@mui/joy';
import HelpOutlineOutlinedIcon from '@mui/icons-material/HelpOutlineOutlined';
import WarningIcon from '@mui/icons-material/Warning';
import { useLockAnimation } from '@/app/contexts/lockanimationcontext';
import { useSession } from 'next-auth/react';

export default function DashboardPage() {
  const { triggerPulse, isPulsing } = useLockAnimation();
  const { data: session } = useSession();
  const userName = session?.user?.name;
  const userRole = session?.user?.userStatus;
  const allowedSites = session?.user?.sites;
  return (
    <Box
      sx={{
        display: 'flex',
        flexGrow: 1,
        width: '99%',
        flexDirection: 'column',
        marginBottom: 5
      }}
    >
      <Card variant="plain">
        <CardContent>
          <Typography level={'title-lg'} sx={{ alignSelf: 'center' }}>
            Welcome, {userName}!
          </Typography>
        </CardContent>
      </Card>
      <Stack direction={'row'} divider={<Divider orientation="vertical" sx={{ mx: 1 }} />}>
        <Card variant="soft" color="primary" invertedColors sx={{ width: '50%' }}>
          <CardContent>
            <Typography level="title-lg">Core Functions and Features</Typography>
            <List marker="disc">
              <ListItem>
                <ListItemContent>
                  <Typography level="body-md">
                    Use the selection menus to pick your <strong>site</strong>, <strong>plot</strong>, and <strong>census</strong>
                  </Typography>
                </ListItemContent>
              </ListItem>
              <ListItem>
                <ListItemContent>
                  <Typography level="body-md">
                    The navigation menu will <strong>not</strong> become visible until you have selected a site, plot, and census.
                  </Typography>
                </ListItemContent>
              </ListItem>
              <ListItem>
                <ListItemContent>
                  <Typography level="body-md">You will need to submit supporting data before being able to submit new measurements for your census.</Typography>
                </ListItemContent>
              </ListItem>
              <ListItem>
                <ListItemContent>
                  <Typography level="body-md">Stem & Plot Details - Use this supporting menu to enter fixed data for your census.</Typography>
                </ListItemContent>
              </ListItem>
              <ListItem nested>
                <ListSubheader>Stem & Plot Details</ListSubheader>
                <List marker="circle">
                  <ListItem>
                    <ListItemContent>
                      <Typography level="body-md">
                        <strong>Stem Codes</strong> - Submit attribute information for stems here. <strong>Does not require a census.</strong>
                      </Typography>
                    </ListItemContent>
                  </ListItem>
                  <ListItem>
                    <ListItemContent>
                      <Typography level="body-md">
                        <strong>Personnel</strong> - Submit personnel working in your census here. <strong>Requires a census.</strong>
                      </Typography>
                    </ListItemContent>
                  </ListItem>
                  <ListItem>
                    <ListItemContent>
                      <Typography level="body-md">
                        <strong>Quadrats</strong> - Submit quadrat information for stems here. <strong>Requires a census.</strong>
                      </Typography>
                    </ListItemContent>
                  </ListItem>
                  <ListItem>
                    <ListItemContent>
                      <Typography level="body-md">
                        <strong>Species List</strong> - Submit species and taxonomy information for stems here. <strong>Does not require a census.</strong>
                      </Typography>
                    </ListItemContent>
                  </ListItem>
                  <ListItem>
                    <ListItemContent>
                      <Typography level="body-md">
                        <strong>Plot-Species List</strong> - See existing taxonomy information for stems in your plot and census here.{' '}
                        <strong>Requires a census.</strong>
                      </Typography>
                    </ListItemContent>
                  </ListItem>
                </List>
              </ListItem>
            </List>
            <Tooltip title={isPulsing ? undefined : 'This form creates and submits a Github issue!'}>
              <Chip variant="soft" startDecorator={<HelpOutlineOutlinedIcon fontSize="medium" />} onClick={triggerPulse}>
                <Stack direction={'column'}>
                  <Typography level="body-md">This is a feedback form!</Typography>
                </Stack>
              </Chip>
            </Tooltip>
          </CardContent>
        </Card>
        <Card variant="soft" color="primary" invertedColors sx={{ width: '50%' }}>
          <CardContent>
            <Typography level="title-lg" sx={{ marginBottom: 1 }}>
              User-Specific Info
            </Typography>
            <Stack direction={'row'} divider={<Divider orientation={'vertical'} sx={{ mx: 1 }} />}>
              <Stack direction={'column'} spacing={0.5}>
                <Typography level={'body-md'} sx={{ alignSelf: 'flex-start' }}>
                  Assigned Role: <strong>{userRole}</strong>
                </Typography>
                <Chip variant="soft" startDecorator={<WarningIcon />}>
                  Is this incorrect?
                </Chip>
              </Stack>
              <Stack direction={'column'}>
                <Typography level={'body-md'} sx={{ alignSelf: 'flex-start' }}>
                  You have access to the following sites:
                </Typography>
                <Stack direction={'row'} divider={<Divider orientation={'vertical'} sx={{ mx: 1 }} />}>
                  {allowedSites?.map(site => (
                    <Typography level={'body-md'} key={site.schemaName}>
                      <strong>{site.siteName}</strong>
                    </Typography>
                  ))}
                </Stack>
              </Stack>
            </Stack>
            <Divider orientation={'horizontal'} sx={{ my: 1 }} />
          </CardContent>
        </Card>
      </Stack>
    </Box>
  );
}
