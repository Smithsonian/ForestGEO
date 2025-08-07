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
import ProgressPieChart from '@/components/metrics/progresspiechart';

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
  const [toggleSwitch, setToggleSwitch] = useState(true);

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
    <Box role="region" aria-label="Dashboard page container" sx={{ display: 'flex', flexGrow: 1, width: '99%', flexDirection: 'column', mb: 5 }}>
      <Card variant="plain" aria-labelledby="dashboard-header-title">
        <CardContent>
          <Typography id="dashboard-header-title" level="title-lg" component="h1">
            Welcome, {userName}!
          </Typography>
        </CardContent>
      </Card>

      <Stack direction="row" divider={<Divider orientation="vertical" sx={{ mx: 1 }} />} sx={{ width: '100%', height: '100%' }}>
        {/* Census Statistics Card */}
        <Card variant="soft" color="primary" invertedColors sx={{ width: '50%' }} aria-labelledby="census-statistics-heading stats-display-heading">
          <CardContent sx={{ px: 0, width: '100%', height: '100%' }}>
            <Typography id="census-statistics-heading" level="title-lg">
              Census Statistics
            </Typography>
            <Typography id="stats-display-heading" level="title-md" alignSelf="center">
              {toggleSwitch ? 'Tachometer View' : 'Pie Chart View'}
            </Typography>

            <Box
              role="button"
              tabIndex={0}
              aria-pressed={toggleSwitch}
              aria-label={toggleSwitch ? 'Switch to pie chart view' : 'Switch to tachometer view'}
              sx={{ height: '50%', width: '100%' }}
              onClick={() => setToggleSwitch(!toggleSwitch)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setToggleSwitch(!toggleSwitch);
                }
              }}
            >
              {toggleSwitch ? (
                <ProgressTachometer {...progressTacho} aria-label="Quadrat population tachometer chart" />
              ) : (
                <ProgressPieChart {...progressTacho} aria-label="Quadrat population pie chart" />
              )}
            </Box>

            {/* List of unpopulated quadrats */}
            <Box role="group" aria-labelledby="missing-quadrats-heading" sx={{ mt: 2, textAlign: 'center', alignItems: 'center', width: '100%' }}>
              <Typography id="missing-quadrats-heading" level="body-lg">
                The following quadrat names do not have any recorded data for this census:
              </Typography>
              <Stack direction="row" alignItems="center" role="list" aria-label="List of unpopulated quadrats">
                {progressTacho.UnpopulatedQuadrats.map(uq => (
                  <Chip key={uq} color="primary" role="listitem" aria-label={`Unpopulated quadrat named ${uq}`}>
                    {uq}
                  </Chip>
                ))}
              </Stack>
            </Box>

            <Divider orientation="horizontal" sx={{ my: 1 }} />

            <Stack direction="row" spacing={1} role="group" aria-label="Active personnel statistics">
              <Typography level="body-lg">Personnel Active in this Census:</Typography>
              <Chip aria-label={`${activeUsers} personnel active`}>{activeUsers}</Chip>
            </Stack>

            <Stack direction="row" spacing={1} role="group" aria-label="Stems recorded statistics">
              <Typography level="body-lg">Stems Recorded in Census:</Typography>
              <Chip aria-label={`${countStems} stems recorded`}>{countStems}</Chip>
            </Stack>

            <Stack direction="row" spacing={1} role="group" aria-label="Trees recorded statistics">
              <Typography level="body-lg">Trees Recorded in Census:</Typography>
              <Chip aria-label={`${countTrees} trees recorded`}>{countTrees}</Chip>
            </Stack>

            <Divider orientation="horizontal" sx={{ my: 2 }} />

            <Tooltip title={isPulsing ? undefined : 'This form creates and submits a Github issue!'}>
              <Chip
                component="div"
                role={'button'}
                tabIndex={0}
                aria-label="Open feedback form"
                variant="soft"
                startDecorator={<HelpOutlineOutlinedIcon fontSize="medium" />}
                onClick={triggerPulse}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    triggerPulse();
                  }
                }}
              >
                <Typography level="body-md">This is a feedback form!</Typography>
              </Chip>
            </Tooltip>
          </CardContent>
        </Card>

        {/* User-Specific Info Card */}
        <Card variant="soft" color="primary" invertedColors sx={{ width: '50%', display: 'flex', flexDirection: 'column' }} aria-labelledby="user-info-heading">
          <CardContent sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, p: 2 }}>
            <Typography id="user-info-heading" level="title-lg" component="h2" sx={{ mb: 1 }}>
              User-Specific Info
            </Typography>
            <Stack direction="row" divider={<Divider orientation="vertical" sx={{ mx: 1 }} />}>
              <Stack direction="column" spacing={0.5} role="group" aria-label="User role and email">
                <Box>
                  <Typography level="body-md">Assigned Role:</Typography>
                  <Typography level="body-md" fontWeight="bold">
                    {userRole}
                  </Typography>
                </Box>
                <Chip variant="soft" startDecorator={<WarningIcon />} component="button" aria-label="Report incorrect role">
                  Is this incorrect?
                </Chip>
                <Divider orientation="horizontal" />
                <Box>
                  <Typography level="body-md">Registered Email:</Typography>
                  <Typography level="body-md" fontWeight="bold">
                    {userEmail}
                  </Typography>
                </Box>
              </Stack>
              <Stack direction="column" sx={{ justifyContent: 'center', width: '100%' }} role="group" aria-labelledby="sites-access-heading">
                <Typography id="sites-access-heading" level="body-md">
                  You have access to the following sites:
                </Typography>
                <Box
                  component="div"
                  role="list"
                  aria-label="Accessible sites list"
                  sx={{ display: 'grid', gridTemplateRows: 'repeat(3, auto)', gridAutoFlow: 'column', rowGap: 0.5, columnGap: 0.5 }}
                >
                  {allowedSites?.map(site => (
                    <Chip key={site.schemaName} variant="soft" startDecorator={<CheckIcon />} role="listitem" aria-label={`Access to site: ${site.siteName}`}>
                      {site.siteName}
                    </Chip>
                  ))}
                </Box>
              </Stack>
            </Stack>

            <Divider orientation="horizontal" sx={{ my: 1 }} />

            <AccordionGroup>
              <Accordion aria-label="File upload history accordion">
                <AccordionSummary id="file-upload-summary" aria-controls="file-upload-details">
                  File Upload History
                </AccordionSummary>
                <AccordionDetails
                  id="file-upload-details"
                  aria-labelledby="file-upload-summary"
                  sx={{ p: 0, m: 0, overflowY: 'auto', '&.MuiCollapse-wrapperInner, &.MuiCollapse-hidden': { p: 0, m: 0 } }}
                >
                  <List aria-label="Uploaded files list">
                    {(filesUploaded ?? []).map((file, index) => (
                      <ListItem key={index}>
                        <ListItemDecorator>
                          <FileDownload aria-hidden="true" />
                        </ListItemDecorator>
                        <ListItemContent>
                          <Chip aria-label={`File name: ${file.name}`}>{file.name}</Chip> uploaded by{' '}
                          <Chip aria-label={`Uploader: ${file.user}`}>{file.user}</Chip>
                        </ListItemContent>
                      </ListItem>
                    ))}
                  </List>
                </AccordionDetails>
              </Accordion>
            </AccordionGroup>

            <Divider orientation="horizontal" sx={{ my: 1 }} />

            <Box role="region" aria-labelledby="recent-changes-heading" sx={{ height: '100%' }}>
              <Typography id="recent-changes-heading" level="title-lg" fontWeight="bold" sx={{ mb: 1 }}>
                Recent Changes
              </Typography>
              <Stepper orientation="vertical" role="list" aria-label="Recent changes stepper">
                {changelogHistory.map((changelog, index) => (
                  <Step
                    key={changelog.id ?? `placeholder-${index}`}
                    role="listitem"
                    aria-label={
                      changelog.id
                        ? `Change ${index + 1}: ${changelog.operation} on ${changelog.tableName} at ${moment(changelog.changeTimestamp).format('MMMM Do YYYY, h:mm:ss a')}`
                        : `Placeholder entry ${index + 1}`
                    }
                    indicator={
                      <Skeleton loading={changelog.id === undefined} variant="circular" animation="wave">
                        <Avatar size="lg" aria-hidden="true" alt={'changelog id number'}>
                          {changelog.id}
                        </Avatar>
                      </Skeleton>
                    }
                  >
                    <AccordionGroup>
                      <Accordion
                        disabled={isLoading || changelog.id === undefined}
                        aria-label={changelog.id ? `Details for change ${index + 1}` : 'No change details available'}
                      >
                        <AccordionSummary
                          id={`change-summary-acc-${index}`}
                          aria-controls={`change-details-${index}`}
                          aria-labelledby={`change-summary-${index}`}
                        >
                          <Box sx={{ display: 'flex', flex: 1, alignItems: 'center' }} aria-labelledby={`change-summary-${index}`}>
                            <Skeleton loading={!changelog.operation} sx={{ width: '95%' }} animation="wave">
                              <Typography id={`change-summary-${index}`} level="title-md" fontWeight="bold" sx={{ width: '100%' }}>
                                {changelog.operation} ON {changelog.tableName} at {moment(changelog.changeTimestamp).format('dddd, MMMM Do YYYY, hh:mm:ss a')}
                              </Typography>
                            </Skeleton>
                          </Box>
                        </AccordionSummary>
                        <AccordionDetails id={`change-details-${index}`} aria-labelledby={`change-summary-acc-${index}`}>
                          <Box role="group" aria-label={`Change details for entry ${index + 1}`}>
                            <Typography level="body-md">Updating:</Typography>
                            <Stack direction="row" spacing={2}>
                              <Card role="group" aria-label="Old row data">
                                <CardContent>
                                  <Typography level="body-sm" fontWeight="bold">
                                    Old Row
                                  </Typography>
                                  <Divider orientation="horizontal" sx={{ my: 0.25 }} />
                                  {changelog.oldRowState && Object.keys(changelog.oldRowState).length > 0 ? (
                                    <Box role="list" aria-label="Old row field list">
                                      {Object.entries(changelog.oldRowState).map(([key, value]) => (
                                        <Typography key={key} role="listitem" level="body-md">
                                          <strong>{key}</strong>: {value ?? 'NULL'}
                                        </Typography>
                                      ))}
                                    </Box>
                                  ) : (
                                    <Typography level="body-sm" fontWeight="bold">
                                      No previous data available
                                    </Typography>
                                  )}
                                </CardContent>
                              </Card>
                              <Typography level="body-md" fontWeight="bold" sx={{ alignSelf: 'center' }}>
                                to
                              </Typography>
                              <Card role="group" aria-label="New row data">
                                <CardContent>
                                  <Typography level="body-sm" fontWeight="bold">
                                    New Row
                                  </Typography>
                                  <Divider orientation="horizontal" sx={{ my: 0.25 }} />
                                  {changelog.newRowState && Object.keys(changelog.newRowState).length > 0 ? (
                                    <Box role="list" aria-label="New row field list">
                                      {Object.entries(changelog.newRowState).map(([key, value]) => (
                                        <Typography key={key} role="listitem" level="body-md">
                                          <strong>{key}</strong>: {value ?? 'NULL'}
                                        </Typography>
                                      ))}
                                    </Box>
                                  ) : (
                                    <Typography level="body-sm" fontWeight="bold">
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
