'use client';

import {
  Accordion,
  AccordionDetails,
  AccordionGroup,
  AccordionSummary,
  Box,
  Card,
  CardContent,
  Chip,
  Divider,
  List,
  ListItem,
  ListItemContent,
  ListSubheader,
  Stack,
  Step,
  StepIndicator,
  Stepper,
  Tooltip,
  Typography
} from '@mui/joy';
import HelpOutlineOutlinedIcon from '@mui/icons-material/HelpOutlineOutlined';
import WarningIcon from '@mui/icons-material/Warning';
import CheckIcon from '@mui/icons-material/Check';
import { useLockAnimation } from '@/app/contexts/lockanimationcontext';
import { useSession } from 'next-auth/react';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import { useEffect, useState } from 'react';
import moment from 'moment';
import { UnifiedChangelogRDS } from '@/config/sqlrdsdefinitions/core';

export default function DashboardPage() {
  const { triggerPulse, isPulsing } = useLockAnimation();
  const { data: session } = useSession();
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const userName = session?.user?.name;
  const userEmail = session?.user?.email;
  const userRole = session?.user?.userStatus;
  const allowedSites = session?.user?.sites;

  const [changelogHistory, setChangelogHistory] = useState<UnifiedChangelogRDS[]>([]);

  async function loadChangelogHistory() {
    try {
      const response = await fetch(`/api/changelog/overview/unifiedchangelog?schema=${currentSite?.schemaName}`, { method: 'GET' });
      const results = await response.json();
      setChangelogHistory(results);
    } catch (error) {
      console.error('Failed to load changelog history', error);
    }
  }

  useEffect(() => {
    if (currentSite && currentPlot && currentCensus) loadChangelogHistory().catch(console.error);
  }, [currentSite, currentPlot, currentCensus]);

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
                <Box>
                  <Typography level={'body-md'} sx={{ alignSelf: 'flex-start' }}>
                    Assigned Role:
                  </Typography>
                  <Typography level={'body-md'} fontWeight={'bold'}>
                    {userRole}
                  </Typography>
                </Box>
                <Chip variant="soft" startDecorator={<WarningIcon />}>
                  Is this incorrect?
                </Chip>
                <Divider orientation={'horizontal'} />
                <Box>
                  <Typography level={'body-md'}>Registered Email:</Typography>
                  <Typography level={'body-md'} fontWeight={'bold'}>
                    {userEmail}
                  </Typography>
                </Box>
              </Stack>
              <Stack direction={'column'} sx={{ justifyContent: 'center', alignContent: 'center', width: '100%', boxSizing: 'border-box' }}>
                <Typography level={'body-md'} sx={{ alignSelf: 'flex-start', width: '100%' }}>
                  You have access to the following sites:
                </Typography>
                <Stack spacing={0.5}>
                  {allowedSites?.map(site => (
                    <Chip key={site.schemaName} variant="soft" startDecorator={<CheckIcon />} sx={{ flexBasis: 'auto' }}>
                      <Typography level={'body-md'} key={site.schemaName} sx={{ marginBottom: 1, wordBreak: 'break-word', flexBasis: 'auto' }}>
                        <strong>{site.siteName}</strong>
                      </Typography>
                    </Chip>
                  ))}
                </Stack>
              </Stack>
            </Stack>
            <Divider orientation={'horizontal'} sx={{ my: 1 }} />
            {currentSite && currentPlot && currentCensus && (
              <Box>
                <Typography level={'title-lg'} fontWeight={'bold'} sx={{ marginBottom: 1 }}>
                  Recent Changes
                </Typography>
                <Stepper orientation="vertical">
                  {changelogHistory.length > 0 &&
                    changelogHistory.map(changelog => (
                      <Step
                        key={changelog.id}
                        indicator={
                          <StepIndicator variant={'soft'} color={'primary'}>
                            {changelog.id}
                          </StepIndicator>
                        }
                      >
                        <AccordionGroup>
                          <Accordion>
                            <AccordionSummary>
                              <Typography level={'title-md'} fontWeight={'bold'}>
                                {changelog.operation} ON {changelog.tableName} at {moment(changelog?.changeTimestamp).toLocaleString()}
                              </Typography>
                            </AccordionSummary>
                            <AccordionDetails>
                              <Box>
                                <Typography level={'body-md'}>Updating:</Typography>
                                <Stack direction={'row'}>
                                  <Card>
                                    <CardContent>
                                      <Typography level={'body-sm'} fontWeight={'bold'}>
                                        Old Row
                                      </Typography>
                                      <Divider orientation={'horizontal'} sx={{ my: 0.25 }} />
                                      {changelog.oldRowState !== undefined &&
                                        changelog.oldRowState !== null &&
                                        Object.entries(changelog.oldRowState).map(([key, value]) => (
                                          <Stack direction={'row'} key={key}>
                                            <Typography level={'body-md'}>
                                              <strong>{key}</strong>: {value ?? 'NULL'}
                                            </Typography>
                                          </Stack>
                                        ))}
                                      {changelog.oldRowState === null && (
                                        <Typography level={'body-sm'} fontWeight={'bold'}>
                                          NULL
                                        </Typography>
                                      )}
                                    </CardContent>
                                  </Card>
                                  <Typography level={'body-md'} fontWeight={'bold'} sx={{ mx: 2 }}>
                                    to
                                  </Typography>
                                  <Card>
                                    <CardContent>
                                      <Typography level={'body-sm'} fontWeight={'bold'}>
                                        New Row
                                      </Typography>
                                      <Divider orientation={'horizontal'} sx={{ my: 0.25 }} />
                                      {changelog.newRowState !== undefined &&
                                        changelog.newRowState !== null &&
                                        Object.entries(changelog.newRowState).map(([key, value]) => (
                                          <Stack direction={'row'} key={key}>
                                            <Typography level={'body-md'}>
                                              <strong>{key}</strong>: {value ?? 'NULL'}
                                            </Typography>
                                          </Stack>
                                        ))}
                                      {changelog.newRowState === null && (
                                        <Typography level={'body-sm'} fontWeight={'bold'}>
                                          NULL
                                        </Typography>
                                      )}
                                    </CardContent>
                                  </Card>
                                </Stack>
                              </Box>
                            </AccordionDetails>
                          </Accordion>
                        </AccordionGroup>

                        <Stepper>
                          <Step orientation={'vertical'}></Step>
                        </Stepper>
                      </Step>
                    ))}
                </Stepper>
              </Box>
            )}
          </CardContent>
        </Card>
      </Stack>
    </Box>
  );
}
