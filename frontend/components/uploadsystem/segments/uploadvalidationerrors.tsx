'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { useIsMounted } from '@/app/hooks/useIsMounted';
import { ReviewStates } from '@/config/macros/uploadsystemmacros';
import { Box, Button, Card, CardContent, Divider, Stack, Typography } from '@mui/joy';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/compat-hooks';
import { ErrorOutline, CheckCircleOutline, WarningAmber } from '@mui/icons-material';
import ailogger from '@/ailogger';

interface UploadValidationErrorsProps {
  setReviewState: (state: ReviewStates) => void;
  isReingestion?: boolean;
}

export default function UploadValidationErrors({ setReviewState, isReingestion = false }: UploadValidationErrorsProps) {
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();

  const [failedCount, setFailedCount] = useState<number>(0);
  const [tempCount, setTempCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);

  // Track mount state to prevent state updates after unmount
  const { isMountedRef } = useIsMounted();

  // Extract census ID to satisfy ESLint dependency rules
  const censusID = currentCensus?.dateRanges?.[0]?.censusID;

  const fetchCounts = useCallback(async () => {
    if (!currentSite?.schemaName || !currentPlot?.plotID || !censusID) {
      ailogger.error('Missing required context for fetching validation error counts');
      return;
    }

    if (isMountedRef.current) {
      setIsLoading(true);
    }
    try {
      // Get failed measurements count
      const failedResponse = await fetch(`/api/admin/clear/failedmeasurements/${currentSite.schemaName}/${currentPlot.plotID}/${censusID}`, { method: 'GET' });

      if (failedResponse.ok && isMountedRef.current) {
        const failedData = await failedResponse.json();
        if (isMountedRef.current) {
          setFailedCount(failedData.recordCount || 0);
        }
      } else if (!failedResponse.ok) {
        ailogger.error(`Failed to fetch failed measurements count: ${failedResponse.status}`);
      }

      // Get temporary measurements count
      const tempResponse = await fetch(`/api/admin/clear/temporarymeasurements/${currentSite.schemaName}/${currentPlot.plotID}/${censusID}`, { method: 'GET' });

      if (tempResponse.ok && isMountedRef.current) {
        const tempData = await tempResponse.json();
        if (isMountedRef.current) {
          setTempCount(tempData.recordCount || 0);
        }
      } else if (!tempResponse.ok) {
        ailogger.error(`Failed to fetch temporary measurements count: ${tempResponse.status}`);
      }
    } catch (error: any) {
      ailogger.error('Failed to fetch validation error counts:', error);
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [currentSite?.schemaName, currentPlot?.plotID, censusID]);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  const handleProceedAnyway = () => {
    if (isReingestion) {
      ailogger.warn(`Reingestion completed with ${failedCount} failed measurements. Proceeding to COMPLETE (skipping Azure upload).`);
      setReviewState(ReviewStates.COMPLETE);
    } else {
      ailogger.warn(`User chose to proceed despite ${failedCount} failed measurements`);
      setReviewState(ReviewStates.UPLOAD_AZURE);
    }
  };

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <Stack spacing={2} alignItems="center">
          <Typography level="body-lg">Loading validation results...</Typography>
        </Stack>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        maxWidth: '800px',
        margin: '0 auto',
        p: 3,
        '@keyframes slideIn': {
          from: {
            opacity: 0,
            transform: 'translateX(-20px)'
          },
          to: {
            opacity: 1,
            transform: 'translateX(0)'
          }
        },
        '@keyframes slideUp': {
          from: {
            opacity: 0,
            transform: 'translateY(20px)'
          },
          to: {
            opacity: 1,
            transform: 'translateY(0)'
          }
        }
      }}
    >
      <Stack spacing={2} sx={{ animation: 'slideIn 0.5s ease-out' }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            p: 2,
            borderRadius: 'lg',
            bgcolor: 'warning.softBg',
            border: theme => `2px solid ${theme.palette.warning[200]}`,
            boxShadow: theme => `0 4px 12px ${theme.palette.warning.softBg}`
          }}
        >
          <WarningAmber
            sx={{
              fontSize: 40,
              color: 'warning.solidBg',
              animation: 'pulse 2s ease-in-out infinite',
              '@keyframes pulse': {
                '0%, 100%': { opacity: 1 },
                '50%': { opacity: 0.6 }
              }
            }}
            aria-hidden="true"
          />
          <Box>
            <Typography level="h2" sx={{ color: 'warning.solidBg' }}>
              Validation Completed with Errors
            </Typography>
            <Typography level="body-md" sx={{ color: 'warning.plainColor', mt: 0.5 }}>
              The validation process has completed, but some measurements failed validation and were moved to the failed measurements table.
            </Typography>
          </Box>
        </Box>
      </Stack>

      <Divider sx={{ opacity: 0.3 }} />

      <Stack spacing={2} sx={{ animation: 'slideUp 0.6s ease-out' }}>
        <Card
          variant="outlined"
          color="danger"
          sx={{
            background: theme => `linear-gradient(135deg, ${theme.palette.danger.softBg} 0%, rgba(239, 68, 68, 0.05) 100%)`,
            borderWidth: 2,
            borderColor: 'danger.outlinedBorder',
            transition: 'all 0.3s ease',
            '&:hover': {
              transform: 'translateY(-4px)',
              boxShadow: theme => `0 8px 24px ${theme.palette.danger.softBg}`
            }
          }}
        >
          <CardContent>
            <Stack direction="row" spacing={2} alignItems="center">
              <Box
                sx={{
                  p: 1.5,
                  borderRadius: 'md',
                  bgcolor: 'danger.softBg',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <ErrorOutline sx={{ fontSize: 32, color: 'danger.solidBg' }} aria-hidden="true" />
              </Box>
              <Box sx={{ flex: 1 }}>
                <Typography level="title-lg" color="danger" sx={{ fontWeight: 700 }}>
                  {failedCount} Failed Measurements
                </Typography>
                <Typography level="body-sm" sx={{ mt: 0.5 }}>
                  These measurements did not pass validation checks and require review.
                </Typography>
              </Box>
            </Stack>
          </CardContent>
        </Card>

        {tempCount > 0 && (
          <Card
            variant="outlined"
            color="warning"
            sx={{
              background: theme => `linear-gradient(135deg, ${theme.palette.warning.softBg} 0%, rgba(245, 158, 11, 0.05) 100%)`,
              borderWidth: 2,
              borderColor: 'warning.outlinedBorder',
              transition: 'all 0.3s ease',
              animation: 'slideUp 0.7s ease-out',
              '&:hover': {
                transform: 'translateY(-4px)',
                boxShadow: theme => `0 8px 24px ${theme.palette.warning.softBg}`
              }
            }}
          >
            <CardContent>
              <Stack direction="row" spacing={2} alignItems="center">
                <Box
                  sx={{
                    p: 1.5,
                    borderRadius: 'md',
                    bgcolor: 'warning.softBg',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <WarningAmber sx={{ fontSize: 32, color: 'warning.solidBg' }} aria-hidden="true" />
                </Box>
                <Box sx={{ flex: 1 }}>
                  <Typography level="title-lg" color="warning" sx={{ fontWeight: 700 }}>
                    {tempCount} Measurements in Temporary Storage
                  </Typography>
                  <Typography level="body-sm" sx={{ mt: 0.5 }}>
                    These measurements are still in the temporary table and may need processing.
                  </Typography>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        )}
      </Stack>

      <Divider sx={{ opacity: 0.3 }} />

      <Stack spacing={2} sx={{ animation: 'slideUp 0.8s ease-out' }}>
        <Button
          size="lg"
          variant="solid"
          color="success"
          onClick={handleProceedAnyway}
          startDecorator={<CheckCircleOutline aria-hidden="true" />}
          sx={{
            background: theme => `linear-gradient(135deg, ${theme.palette.success[500]} 0%, ${theme.palette.success[600]} 100%)`,
            transition: 'all 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
            position: 'relative',
            overflow: 'hidden',
            fontWeight: 600,
            '&::before': {
              content: '""',
              position: 'absolute',
              top: 0,
              left: '-100%',
              width: '100%',
              height: '100%',
              background: theme => `linear-gradient(90deg, transparent, ${theme.palette.success[300]}, transparent)`,
              transition: 'left 0.5s ease'
            },
            '&:hover': {
              transform: 'translateY(-4px) scale(1.02)',
              boxShadow: theme => `0 12px 32px ${theme.palette.success[300]}`,
              '&::before': {
                left: '100%'
              }
            },
            '&:active': {
              transform: 'translateY(-2px) scale(0.98)'
            }
          }}
        >
          {isReingestion ? 'Complete Reingestion' : 'Continue to Upload Completion'}
        </Button>

        <Typography level="body-sm" sx={{ pl: 2, color: 'text.secondary', lineHeight: 1.6 }}>
          {isReingestion
            ? 'Complete the reingestion process. Failed measurements will remain in the failed measurements table and can be reviewed later from the Measurements Summary View.'
            : 'Continue with the upload process. Failed measurements will remain in the failed measurements table and can be reviewed later from the Measurements Summary View.'}
        </Typography>
      </Stack>

      <Divider sx={{ opacity: 0.3 }} />

      <Card
        variant="soft"
        color="neutral"
        sx={{
          animation: 'slideUp 0.9s ease-out',
          background: theme => `linear-gradient(135deg, ${theme.palette.neutral.softBg} 0%, rgba(120, 113, 108, 0.05) 100%)`,
          borderLeft: theme => `4px solid ${theme.palette.neutral[400]}`
        }}
      >
        <CardContent>
          <Typography
            level="body-sm"
            startDecorator={
              <WarningAmber
                fontSize="small"
                aria-hidden="true"
                sx={{
                  color: 'neutral.plainColor'
                }}
              />
            }
            sx={{ lineHeight: 1.6 }}
          >
            <strong>Note:</strong> Failed measurements can always be accessed later from the Measurements Summary View by clicking the "Failed Measurements"
            button in the toolbar.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
