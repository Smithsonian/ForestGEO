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
  ListItemDecorator,
  Skeleton,
  Stack,
  Step,
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
import { useCallback, useEffect, useState } from 'react';
import { UnifiedChangelogRDS } from '@/config/sqlrdsdefinitions/core';
import moment from 'moment';
import Avatar from '@mui/joy/Avatar';
import { UploadedFileData } from '@/config/macros/formdetails';
import ProgressTachometer from '@/components/metrics/progresstachometer';
import { FileDownload } from '@mui/icons-material';
import ListItemContent from '@mui/joy/ListItemContent';
import ailogger from '@/ailogger';

interface ProgressTachoType {
  TotalQuadrats: number;
  PopulatedQuadrats: number;
  PopulatedPercent: number;
  UnpopulatedQuadrats: string[];
}

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

  const [changelogHistory, setChangelogHistory] = useState<UnifiedChangelogRDS[]>(Array(5));
  const [isLoading, setIsLoading] = useState(false);
  const [progressTacho, setProgressTacho] = useState<ProgressTachoType>({
    TotalQuadrats: 0,
    PopulatedPercent: 0,
    PopulatedQuadrats: 0,
    UnpopulatedQuadrats: []
  });
  const [activeUsers, setActiveUsers] = useState(0);
  const [countStems, setCountStems] = useState(0);
  const [countTrees, setCountTrees] = useState(0);
  const [filesUploaded, setFilesUploaded] = useState<UploadedFileData[]>([]);

  const loadProgressTachometer = useCallback(async () => {
    if (!currentSite?.schemaName || !currentPlot?.plotName || !currentCensus?.dateRanges[0].censusID) return null;
    try {
      const { TotalQuadrats, PopulatedQuadrats, PopulatedPercent, UnpopulatedQuadrats } = await (
        await fetch(
          `/api/dashboardmetrics/ProgressTachometer/${currentSite?.schemaName ?? ''}/${currentPlot?.plotID ?? 0}/${currentCensus?.dateRanges[0].censusID ?? 0}?plot=${currentPlot?.plotName ?? ''}`
        )
      ).json();
      ailogger.info(JSON.stringify({ TotalQuadrats, PopulatedQuadrats, PopulatedPercent, UnpopulatedQuadrats }));
      setProgressTacho({ TotalQuadrats, PopulatedQuadrats, PopulatedPercent, UnpopulatedQuadrats: UnpopulatedQuadrats.split(';') });
    } catch (e: any) {
      ailogger.error('ProgressTachometer: ', e);
    }
  }, [currentSite, currentPlot, currentCensus]);

  const loadCountActiveUsers = useCallback(async () => {
    if (!currentSite?.schemaName || !currentPlot?.plotName || !currentCensus?.dateRanges[0].censusID) return null;
    try {
      const { CountActiveUsers } = await (
        await fetch(
          `/api/dashboardmetrics/CountActiveUsers/${currentSite?.schemaName ?? ''}/${currentPlot?.plotID ?? 0}/${currentCensus?.dateRanges[0].censusID ?? 0}?plot=${currentPlot?.plotName ?? ''}`
        )
      ).json();
      setActiveUsers(CountActiveUsers);
    } catch (e: any) {
      ailogger.error('CountActiveUsers: ', e);
    }
  }, [currentSite, currentPlot, currentCensus]);

  const loadFilesUploaded = useCallback(async () => {
    if (!currentSite?.schemaName || !currentPlot?.plotName || !currentCensus?.dateRanges[0].censusID) return null;
    try {
      const { FilesUploaded } = await (
        await fetch(
          `/api/dashboardmetrics/FilesUploaded/${currentSite?.schemaName ?? ''}/${currentPlot?.plotID ?? 0}/${currentCensus?.dateRanges[0].censusID ?? 0}?plot=${currentPlot?.plotName ?? ''}`
        )
      ).json();
      setFilesUploaded(FilesUploaded);
    } catch (e: any) {
      ailogger.error('FilesUploaded: ', e);
    }
  }, [currentSite, currentPlot, currentCensus]);

  const loadCountTrees = useCallback(async () => {
    if (!currentSite?.schemaName || !currentPlot?.plotName || !currentCensus?.dateRanges[0].censusID) return null;
    try {
      const { CountTrees } = await (
        await fetch(
          `/api/dashboardmetrics/CountTrees/${currentSite?.schemaName ?? ''}/${currentPlot?.plotID ?? 0}/${currentCensus?.dateRanges[0].censusID ?? 0}?plot=${currentPlot?.plotName ?? ''}`
        )
      ).json();
      setCountTrees(CountTrees);
    } catch (e: any) {
      ailogger.info('CountTrees: ', e);
    }
  }, [currentSite, currentPlot, currentCensus]);

  const loadCountStems = useCallback(async () => {
    if (!currentSite?.schemaName || !currentPlot?.plotName || !currentCensus?.dateRanges[0].censusID) return null;
    try {
      const { CountStems } = await (
        await fetch(
          `/api/dashboardmetrics/CountStems/${currentSite?.schemaName ?? ''}/${currentPlot?.plotID ?? 0}/${currentCensus?.dateRanges[0].censusID ?? 0}?plot=${currentPlot?.plotName ?? ''}`
        )
      ).json();
      setCountStems(CountStems);
    } catch (e: any) {
      ailogger.info('CountStems: ', e);
    }
  }, [currentSite, currentPlot, currentCensus]);

  async function loadChangelogHistory() {
    try {
      setIsLoading(true);
      if (!currentSite || !currentPlot || !currentCensus) {
        setChangelogHistory(Array(5).fill({}));
        return;
      }
      const response = await fetch(
        `/api/changelog/overview/unifiedchangelog/${currentPlot?.plotID}/${currentCensus?.plotCensusNumber}?schema=${currentSite?.schemaName}`,
        { method: 'GET' }
      );
      try {
        const results: UnifiedChangelogRDS[] = await response.json();

        // Pad the array if it has less than 5 items
        const paddedResults = [...results];
        while (paddedResults.length < 5) {
          paddedResults.push({}); // Push empty objects to pad the array
        }

        setChangelogHistory(paddedResults);
      } catch (e) {
        ailogger.warn('changeloghistory - no json response');
      }
    } catch (error: any) {
      ailogger.error('Failed to load changelog history', error);
      setChangelogHistory(Array(5).fill({})); // Fallback to an empty padded array in case of an error
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (currentSite && currentPlot && currentCensus) {
      loadProgressTachometer().catch(ailogger.error);
      loadCountActiveUsers().catch(ailogger.error);
      loadFilesUploaded().catch(ailogger.error);
      loadCountTrees().catch(ailogger.error);
      loadCountStems().catch(ailogger.error);
      loadChangelogHistory().catch(ailogger.error);
    }
  }, [currentSite, currentPlot, currentCensus, loadProgressTachometer, loadCountActiveUsers, loadFilesUploaded, loadCountTrees, loadCountStems]);

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
      <Stack sx={{ width: '100%', height: '100%' }} direction={'row'} divider={<Divider orientation="vertical" sx={{ mx: 1 }} />}>
        <Card variant="soft" color="primary" invertedColors sx={{ width: '50%' }}>
          <CardContent sx={{ px: 0, width: '100%', height: '100%' }}>
            <Typography level="title-lg">Census Statistics</Typography>
            <Box sx={{ height: '50%', width: '100%' }}>
              <ProgressTachometer {...progressTacho} />
            </Box>
            <Divider orientation={'horizontal'} sx={{ my: 1 }} />
            <Stack direction={'row'} spacing={1}>
              <Typography level={'body-lg'}>Personnel Active in this Census: </Typography>
              <Chip>{activeUsers}</Chip>
            </Stack>
            <Stack direction={'row'} spacing={1}>
              <Typography level={'body-lg'}>Stems Recorded in Census: </Typography>
              <Chip>{countStems}</Chip>
            </Stack>
            <Stack direction={'row'} spacing={1}>
              <Typography level={'body-lg'}>Trees Recorded in Census: </Typography>
              <Chip>{countTrees}</Chip>
            </Stack>
            <Divider orientation={'horizontal'} sx={{ my: 2 }} />
            <Tooltip title={isPulsing ? undefined : 'This form creates and submits a Github issue!'}>
              <Chip variant="soft" startDecorator={<HelpOutlineOutlinedIcon fontSize="medium" />} onClick={triggerPulse}>
                <Stack direction={'column'}>
                  <Typography level="body-md">This is a feedback form!</Typography>
                </Stack>
              </Chip>
            </Tooltip>
          </CardContent>
        </Card>
        <Card
          variant="soft"
          color="primary"
          invertedColors
          sx={{
            width: '50%',
            // make this Card a flex‑column so its content can stretch
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <CardContent
            sx={{
              // stack everything vertically and allow bottom section to grow/shrink
              display: 'flex',
              flexDirection: 'column',
              flexGrow: 1,
              p: 2
            }}
          >
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
                <Box
                  component="div"
                  sx={{
                    display: 'grid',
                    gridTemplateRows: 'repeat(3, auto)',
                    gridAutoFlow: 'column',
                    rowGap: 0.5,
                    columnGap: 0.5
                  }}
                >
                  {allowedSites?.map(site => (
                    <Chip key={site.schemaName} variant="soft" startDecorator={<CheckIcon />} sx={{ flexBasis: 'auto' }}>
                      <Typography level={'body-md'} key={site.schemaName} sx={{ marginBottom: 1, wordBreak: 'break-word', flexBasis: 'auto' }}>
                        <strong>{site.siteName}</strong>
                      </Typography>
                    </Chip>
                  ))}
                </Box>
              </Stack>
            </Stack>
            <Divider orientation={'horizontal'} sx={{ my: 1 }} />
            <AccordionGroup>
              <Accordion>
                <AccordionSummary>File Upload History</AccordionSummary>
                <AccordionDetails
                  sx={{
                    p: 0,
                    m: 0,
                    overflowY: 'auto',
                    // when collapse is closed, make sure nothing sneaks through
                    '&.MuiCollapse-wrapperInner, &.MuiCollapse-hidden': {
                      padding: 0,
                      margin: 0
                    }
                  }}
                >
                  <List>
                    {(filesUploaded ?? []).map((file, index) => (
                      <ListItem key={index}>
                        <ListItemDecorator>
                          <FileDownload />
                        </ListItemDecorator>
                        <ListItemContent>
                          <Chip>{file.name}</Chip> uploaded by <Chip>{file.user}</Chip>
                        </ListItemContent>
                      </ListItem>
                    ))}
                  </List>
                </AccordionDetails>
              </Accordion>
            </AccordionGroup>
            <Divider orientation={'horizontal'} sx={{ my: 1 }} />
            <Box
              sx={{
                height: '100%'
              }}
            >
              <Typography level={'title-lg'} fontWeight={'bold'} sx={{ marginBottom: 1 }}>
                Recent Changes
              </Typography>
              <Stepper orientation="vertical">
                {changelogHistory.map((changelog, index) => (
                  <Step
                    key={changelog.id || `placeholder-${index}`}
                    indicator={
                      <Skeleton loading={changelog.id === undefined} variant={'circular'} animation={'wave'}>
                        <Avatar size={'lg'}>{changelog.id}</Avatar>
                      </Skeleton>
                    }
                  >
                    <AccordionGroup>
                      <Accordion
                        disabled={isLoading || changelog.id === undefined}
                        aria-label={'The 5 most recent changes found in the changelog (if they exist)'}
                      >
                        <AccordionSummary role={'none'}>
                          <Box
                            sx={{ display: 'flex', flex: 1, width: '100%', alignItems: 'center', flexDirection: 'row' }}
                            aria-label={
                              changelog.changeTimestamp
                                ? `Change at index ${index}. The changelog timestamp is ${changelog.changeTimestamp}`
                                : 'No change found'
                            }
                          >
                            <Skeleton loading={changelog.operation === undefined} sx={{ width: '95%' }} animation={'wave'}>
                              <Typography level={'title-md'} fontWeight={'bold'} sx={{ width: '100%' }}>
                                {changelog.operation} ON {changelog.tableName} at {moment(changelog?.changeTimestamp).format('dddd, MMMM Do YYYY, hh:mm:ss a')}
                              </Typography>
                            </Skeleton>
                          </Box>
                        </AccordionSummary>
                        <AccordionDetails>
                          <Box
                            aria-label={
                              changelog.changeTimestamp
                                ? `Details of change at index ${index}. The changelog timestamp is ${changelog.changeTimestamp}`
                                : 'No change details present.'
                            }
                          >
                            <Typography level={'body-md'}>Updating:</Typography>
                            <Stack direction={'row'}>
                              <Card>
                                <CardContent>
                                  <Typography level={'body-sm'} fontWeight={'bold'}>
                                    Old Row
                                  </Typography>
                                  <Divider orientation={'horizontal'} sx={{ my: 0.25 }} />
                                  {changelog.oldRowState && Object.keys(changelog.oldRowState).length > 0 ? (
                                    Object.entries(changelog.oldRowState).map(([key, value]) => (
                                      <Stack direction={'row'} key={key}>
                                        <Typography level={'body-md'}>
                                          <strong>{JSON.stringify(key)}</strong>: {JSON.stringify(value) ?? 'NULL'}
                                        </Typography>
                                      </Stack>
                                    ))
                                  ) : (
                                    <Typography level={'body-sm'} fontWeight={'bold'}>
                                      No previous data available
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
                                  {changelog.newRowState && Object.keys(changelog.newRowState).length > 0 ? (
                                    Object.entries(changelog.newRowState).map(([key, value]) => (
                                      <Stack direction={'row'} key={key}>
                                        <Typography level={'body-md'}>
                                          <strong>{JSON.stringify(key)}</strong>: {JSON.stringify(value) ?? 'NULL'}
                                        </Typography>
                                      </Stack>
                                    ))
                                  ) : (
                                    <Typography level={'body-sm'} fontWeight={'bold'}>
                                      No new data available
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
          </CardContent>
        </Card>
      </Stack>
    </Box>
  );
}
