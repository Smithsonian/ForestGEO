'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Alert, Box, Button, CircularProgress, Divider, Stack, Step, StepIndicator, Stepper, Typography } from '@mui/joy';
import SiteForm from '@/components/provisioning/SiteForm';
import PlotForm from '@/components/provisioning/PlotForm';
import QuadratPlanner from '@/components/provisioning/QuadratPlanner';
import Review from '@/components/provisioning/Review';
import { generateGrid } from '@/lib/provisioning/grid-generator';
import { ProvisioningInputSchema } from '@/lib/provisioning/input-schema';
import { rectsOverlap } from '@/lib/provisioning/steps/validate-inputs';
import type { ProvisioningInput } from '@/lib/provisioning/types';

const STEPS = ['Site', 'Plot', 'Quadrats', 'Review'] as const;

const STEP_SITE_INDEX = 0;
const STEP_PLOT_INDEX = 1;
const STEP_QUADRATS_INDEX = 2;
const STEP_REVIEW_INDEX = 3;

const DEFAULT_INPUT: ProvisioningInput = {
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

function deriveCanAdvance(step: number, input: ProvisioningInput): boolean {
  switch (step) {
    case STEP_SITE_INDEX:
      return ProvisioningInputSchema.shape.site.safeParse(input.site).success;
    case STEP_PLOT_INDEX:
      return ProvisioningInputSchema.shape.plot.safeParse(input.plot).success;
    case STEP_QUADRATS_INDEX:
      return quadratLayoutIsValid(input);
    case STEP_REVIEW_INDEX:
      return true;
    default:
      return false;
  }
}

function quadratLayoutIsValid(input: ProvisioningInput): boolean {
  if (!ProvisioningInputSchema.shape.quadrats.safeParse(input.quadrats).success) return false;

  if (input.quadrats.mode === 'grid') {
    try {
      generateGrid(input.plot, input.quadrats);
      return true;
    } catch {
      return false;
    }
  }

  const rows = input.quadrats.rows;
  for (const row of rows) {
    if (row.startX < 0 || row.startY < 0) return false;
    if (row.startX + row.dimensionX > input.plot.dimensionX) return false;
    if (row.startY + row.dimensionY > input.plot.dimensionY) return false;
  }

  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (rectsOverlap(rows[i], rows[j])) return false;
    }
  }

  return true;
}

export default function ProvisionWizardPage() {
  const { data: session } = useSession();
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [input, setInput] = useState<ProvisioningInput>(DEFAULT_INPUT);
  const [showStepErrors, setShowStepErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isGlobalUser = session?.user?.userStatus === 'global';

  if (session && !isGlobalUser) {
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

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/admin/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
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
        return <PlotForm value={input.plot} onChange={plot => setInput(prev => ({ ...prev, plot }))} showErrors={showStepErrors} />;
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
      <Typography level="h2" sx={{ mb: 3 }}>
        Provision New Site
      </Typography>

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

      <Box sx={{ mb: 4 }}>{renderStepContent()}</Box>

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
