'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Alert, Box, Button, CircularProgress, Divider, Stack, Step, StepIndicator, Stepper, Typography } from '@mui/joy';
import SiteForm from '@/components/provisioning/SiteForm';
import PlotForm from '@/components/provisioning/PlotForm';
import QuadratPlanner from '@/components/provisioning/QuadratPlanner';
import Review from '@/components/provisioning/Review';
import { ProvisioningPlotSchema, ProvisioningSiteSchema } from '@/lib/provisioning/input-schema';
import { quadratLayoutIsValid } from '@/lib/provisioning/quadrat-layout-gate';
import type { ProvisioningPlotInput, ProvisioningRequestInput } from '@/lib/provisioning/types';
import { applyAreaDerivation, resolvePlotAreaChange, type AreaMode } from '@/lib/provisioning/area';

const STEPS = ['Site', 'Plot', 'Quadrats', 'Review'] as const;

const STEP_SITE_INDEX = 0;
const STEP_PLOT_INDEX = 1;
const STEP_QUADRATS_INDEX = 2;
const STEP_REVIEW_INDEX = 3;

const DEFAULT_INPUT: ProvisioningRequestInput = {
  site: {
    siteName: '',
    schemaName: '',
    sqDimX: 5,
    sqDimY: 5,
    defaultUOMDBH: 'mm',
    defaultUOMHOM: 'm',
    doubleDataEntry: false,
    location: '',
    country: ''
  },
  plot: {
    plotName: '',
    dimensionX: 100,
    dimensionY: 100,
    area: 10000,
    globalX: 0,
    globalY: 0,
    globalZ: 0,
    plotShape: 'square',
    description: '',
    defaultDimensionUnits: 'm',
    defaultCoordinateUnits: 'm',
    defaultAreaUnits: 'm2',
    defaultDBHUnits: 'mm',
    defaultHOMUnits: 'm'
  },
  quadrats: {
    mode: 'grid',
    quadratSizeX: 20,
    quadratSizeY: 20,
    namingPattern: 'sequential'
  }
};

function deriveCanAdvance(step: number, input: ProvisioningRequestInput): boolean {
  switch (step) {
    case STEP_SITE_INDEX:
      return ProvisioningSiteSchema.safeParse(input.site).success;
    case STEP_PLOT_INDEX:
      return ProvisioningPlotSchema.safeParse(input.plot).success;
    case STEP_QUADRATS_INDEX:
      return quadratLayoutIsValid(input);
    case STEP_REVIEW_INDEX:
      return true;
    default:
      return false;
  }
}

export default function ProvisionWizardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [input, setInput] = useState<ProvisioningRequestInput>(DEFAULT_INPUT);
  const [areaMode, setAreaMode] = useState<AreaMode>('derived');
  const [showStepErrors, setShowStepErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submitAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      submitAbortRef.current?.abort();
    };
  }, []);

  if (status === 'loading') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  const isGlobalUser = session?.user?.userStatus === 'global';

  if (!isGlobalUser) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Alert color="danger" variant="soft">
          Access denied. This page is only accessible to global administrators.
        </Alert>
      </Box>
    );
  }

  const canAdvance = deriveCanAdvance(step, input);

  function handleNext() {
    if (!canAdvance) {
      setShowStepErrors(true);
      return;
    }
    setShowStepErrors(false);
    setStep(prev => prev + 1);
  }

  function handleBack() {
    setShowStepErrors(false);
    setStep(prev => prev - 1);
  }

  function handlePlotChange(plot: ProvisioningPlotInput, requestedMode?: AreaMode) {
    const resolved = resolvePlotAreaChange(plot, areaMode, requestedMode);
    setAreaMode(resolved.areaMode);
    setInput(prev => ({ ...prev, plot: resolved.plot }));
  }

  function handleAreaModeChange(next: AreaMode) {
    setAreaMode(next);
    if (next === 'derived') {
      setInput(prev => ({ ...prev, plot: applyAreaDerivation(prev.plot, 'derived') }));
    }
  }

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    submitAbortRef.current?.abort();
    const controller = new AbortController();
    submitAbortRef.current = controller;
    try {
      const res = await fetch('/api/admin/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: controller.signal
      });

      if (res.status === 202) {
        const { runId } = await res.json();
        router.push(`/admin/provision/${runId}`);
        return;
      }

      const body = await res.json();

      if (res.status === 400 && body.errors) {
        const fieldErrors: string = body.errors.map((e: { field: string; message: string }) => `${e.field}: ${e.message}`).join('; ');
        setSubmitError(`Validation errors: ${fieldErrors}`);
        return;
      }

      setSubmitError(body.error ?? `Unexpected error (HTTP ${res.status})`);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      const message = err instanceof Error ? err.message : 'Network error';
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  }

  function renderStepContent() {
    switch (step) {
      case STEP_SITE_INDEX:
        return <SiteForm value={input.site} onChange={site => setInput(prev => ({ ...prev, site }))} showErrors={showStepErrors} />;
      case STEP_PLOT_INDEX:
        return (
          <PlotForm value={input.plot} areaMode={areaMode} onAreaModeChange={handleAreaModeChange} onChange={handlePlotChange} showErrors={showStepErrors} />
        );
      case STEP_QUADRATS_INDEX:
        return (
          <QuadratPlanner
            value={input.quadrats}
            onChange={quadrats => setInput(prev => ({ ...prev, quadrats }))}
            plot={input.plot}
            showErrors={showStepErrors}
          />
        );
      case STEP_REVIEW_INDEX:
        return (
          <Stack spacing={2}>
            {submitError && (
              <Alert color="danger" variant="soft">
                {submitError}
              </Alert>
            )}
            <Review value={input} />
          </Stack>
        );
      default:
        return null;
    }
  }

  const isReviewStep = step === STEP_REVIEW_INDEX;

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 800, mx: 'auto', width: '100%' }}>
      <Stepper sx={{ mb: 4 }} aria-label="Provisioning wizard steps">
        {STEPS.map((label, index) => (
          <Step
            key={label}
            indicator={
              <StepIndicator
                variant={index === step ? 'solid' : index < step ? 'soft' : 'outlined'}
                color={index < step ? 'success' : index === step ? 'primary' : 'neutral'}
              >
                {index < step ? '✓' : index + 1}
              </StepIndicator>
            }
          >
            <Typography level="body-sm" sx={{ fontWeight: index === step ? 'bold' : 'normal' }}>
              {label}
            </Typography>
          </Step>
        ))}
      </Stepper>

      <Box sx={{ mb: 4 }}>
        {showStepErrors && !canAdvance && (
          <Alert color="warning" variant="soft" sx={{ mb: 2 }} aria-live="polite">
            Complete the highlighted required fields before continuing to the next step.
          </Alert>
        )}
        {renderStepContent()}
      </Box>

      <Divider sx={{ mb: 2 }} />

      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Button variant="outlined" color="neutral" onClick={handleBack} disabled={step === 0 || submitting}>
          Back
        </Button>

        {isReviewStep ? (
          <Button
            color="success"
            onClick={handleSubmit}
            disabled={submitting}
            startDecorator={submitting ? <CircularProgress size="sm" /> : undefined}
            aria-label="Submit provisioning request"
          >
            {submitting ? 'Provisioning…' : 'Provision Site'}
          </Button>
        ) : (
          <Button onClick={handleNext} disabled={submitting}>
            Next
          </Button>
        )}
      </Stack>
    </Box>
  );
}
