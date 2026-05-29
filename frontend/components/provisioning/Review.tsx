'use client';

import React from 'react';
import { Card, Divider, Stack, Typography } from '@mui/joy';
import type { ProvisioningInput } from '@/lib/provisioning/types';

interface ReviewProps {
  value: ProvisioningInput;
}

function buildQuadratsSummary(quadrats: ProvisioningInput['quadrats']): string {
  if (quadrats.mode === 'grid') {
    return `Grid mode: ${quadrats.quadratSizeX}×${quadrats.quadratSizeY} m, naming = ${quadrats.namingPattern}`;
  }
  return `CSV mode: ${quadrats.rows.length} ${quadrats.rows.length === 1 ? 'row' : 'rows'}`;
}

export default function Review({ value }: ReviewProps) {
  const quadratsSummary = buildQuadratsSummary(value.quadrats);

  return (
    <Card variant="outlined">
      <Typography level="h4">Review Provisioning Inputs</Typography>
      <Divider sx={{ my: 1 }} />
      <Stack spacing={1.5}>
        <Typography level="title-sm" sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Site
        </Typography>
        <Typography>
          <b>Name:</b> {value.site.siteName}
        </Typography>
        <Typography>
          <b>Schema:</b> {value.site.schemaName}
        </Typography>
        <Typography>
          <b>Location:</b> {value.site.location}, {value.site.country}
        </Typography>
        <Typography>
          <b>Subquadrat dimensions:</b> {value.site.sqDimX}×{value.site.sqDimY} m
        </Typography>
        <Typography>
          <b>Default DBH unit:</b> {value.site.defaultUOMDBH} &mdash; <b>Default HOM unit:</b> {value.site.defaultUOMHOM}
        </Typography>
        <Typography>
          <b>Double Data Entry:</b> {value.site.doubleDataEntry ? 'Yes' : 'No'}
        </Typography>

        <Divider sx={{ my: 0.5 }} />

        <Typography level="title-sm" sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Plot
        </Typography>
        <Typography>
          <b>Name:</b> {value.plot.plotName}
        </Typography>
        <Typography>
          <b>Dimensions:</b> {value.plot.dimensionX}×{value.plot.dimensionY} {value.plot.defaultDimensionUnits}
        </Typography>
        <Typography>
          <b>Area:</b> {value.plot.area} {value.plot.defaultAreaUnits}
        </Typography>
        <Typography>
          <b>Shape:</b> {value.plot.plotShape}
        </Typography>
        <Typography>
          <b>Global coordinates:</b> ({value.plot.globalX}, {value.plot.globalY}, {value.plot.globalZ}) {value.plot.defaultCoordinateUnits}
        </Typography>
        <Typography>
          <b>DBH units:</b> {value.plot.defaultDBHUnits} &mdash; <b>HOM units:</b> {value.plot.defaultHOMUnits}
        </Typography>
        {value.plot.description && (
          <Typography>
            <b>Description:</b> {value.plot.description}
          </Typography>
        )}

        <Divider sx={{ my: 0.5 }} />

        <Typography level="title-sm" sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Quadrats
        </Typography>
        <Typography>{quadratsSummary}</Typography>
      </Stack>
    </Card>
  );
}
