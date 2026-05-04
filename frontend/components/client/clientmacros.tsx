'use client';

import { Box, Collapse, LinearProgress, LinearProgressProps, Slide, SlideProps, Typography } from '@mui/material';
import React, { Dispatch, SetStateAction } from 'react';
import { GridColDef } from '@mui/x-data-grid';
import { CELL_ALIGN, HEADER_ALIGN } from '@/config/macros';
import MapperFactory from '@/config/datamapper';
import { AttributesRDS, AttributesResult } from '@/config/sqlrdsdefinitions/core';
import { SpeciesRDS, SpeciesResult, StemRDS, StemResult, TreeRDS, TreeResult } from '@/config/sqlrdsdefinitions/taxonomies';
import { Plot, QuadratRDS, QuadratResult, Site } from '@/config/sqlrdsdefinitions/zones';
import { OrgCensus } from '@/config/sqlrdsdefinitions/timekeeping';
import { Autocomplete } from '@mui/joy';

export function LinearProgressWithLabel(
  props: LinearProgressProps & {
    value?: number;
    currentlyrunningmsg?: string;
    'aria-label'?: string;
    'aria-describedby'?: string;
  }
) {
  const percentage = props.value ? Math.round(props.value) : 0;
  const progressLabel = props['aria-label'] || 'Upload progress';
  const progressText = props.value ? `${percentage}% complete. ${props.currentlyrunningmsg || ''}` : props.currentlyrunningmsg || 'Processing...';

  return (
    <Box sx={{ display: 'flex', flex: 1, alignItems: 'center', flexDirection: 'column', width: '100%' }}>
      <Box sx={{ width: '100%' }}>
        {props.value ? (
          <LinearProgress
            variant="determinate"
            sx={{ width: '100%' }}
            {...props}
            aria-label={progressLabel}
            aria-valuenow={percentage}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext={progressText}
          />
        ) : (
          <LinearProgress variant="indeterminate" sx={{ width: '100%' }} {...props} aria-label={progressLabel} aria-valuetext={progressText} />
        )}
      </Box>
      <Box sx={{ minWidth: 35, display: 'flex', flex: 1, flexDirection: 'column', width: '100%', mt: 1 }} aria-live="polite" aria-atomic="true">
        {props.value ? (
          <Typography variant="body2" color="text.secondary">
            {`${percentage}% --> ${props.currentlyrunningmsg}`}
          </Typography>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {`${props.currentlyrunningmsg}`}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

interface SlideToggleProps {
  isOpen: boolean;
  children: React.ReactNode;
}

export function SlideToggle({ isOpen, children }: SlideToggleProps) {
  return (
    <Collapse in={isOpen}>
      <Box sx={{ overflow: 'hidden' }}>{children}</Box>
    </Collapse>
  );
}

interface TransitionComponentProps extends Omit<SlideProps, 'children'> {
  children: React.ReactElement;
}

export const TransitionComponent: React.FC<TransitionComponentProps> = ({ children, ...props }) => <Slide {...props}>{children}</Slide>;

function applyStandardSettings(col: GridColDef): GridColDef {
  return {
    ...col,
    headerClassName: 'header',
    align: CELL_ALIGN,
    headerAlign: HEADER_ALIGN,
    cellClassName: 'tw-wrap-text'
  };
}

export function standardizeGridColumns(cols: GridColDef[]): GridColDef[] {
  return cols.map(col => applyStandardSettings(col));
}

const SELECTABLE_FIELD_TO_OPTION_KEY: Record<string, string> = {
  tag: 'treeTag',
  treeTag: 'treeTag',
  stemtag: 'stemTag',
  stemTag: 'stemTag',
  quadrat: 'quadratName',
  quadratName: 'quadratName',
  spCode: 'speciesCode',
  spcode: 'speciesCode',
  speciesCode: 'speciesCode',
  codes: 'codes'
};

export function selectableOptionKeyForField(field: string): string {
  return SELECTABLE_FIELD_TO_OPTION_KEY[field] ?? field;
}

export function getSelectableOptionsForField(selectableOpts: Record<string, string[]>, field: string): string[] {
  return selectableOpts[selectableOptionKeyForField(field)] ?? [];
}

/**
 * Helper function to safely fetch and map data for selectable options
 * RDS = mapped type (what we work with in the app)
 * Result = raw API response type
 */
async function fetchAndMapOptions<RDS, Result>(
  endpoint: string,
  mapperType: string,
  extractField: (item: RDS) => string | null | undefined,
  signal?: AbortSignal
): Promise<string[]> {
  try {
    const response = await fetch(endpoint, { signal });
    if (!response.ok) {
      console.warn(`Failed to fetch ${mapperType}: ${response.statusText}`);
      return [];
    }
    const data: Result[] = await response.json();
    const mapper = MapperFactory.getMapper<RDS, Result>(mapperType as any);
    const mappedData: RDS[] = mapper.mapData(data);
    const values = mappedData.map(extractField).filter((code): code is string => code !== null && code !== undefined && code?.trim().length > 0);
    // Trees/stems are unique by (TreeTag, SpeciesID, CensusID), not by tag alone, so the
    // same display string can come from distinct rows. Collapse to one autocomplete option
    // per displayed string here.
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
  } catch (error: any) {
    // Ignore abort errors - they're expected during cleanup
    if (error.name === 'AbortError') {
      return [];
    }
    console.warn(`Error fetching ${mapperType}:`, error);
    return [];
  }
}

/**
 * Loads selectable options for autocomplete fields with proper error handling
 * and optional AbortController support for cancellation
 */
export async function loadSelectableOptions(
  currentSite: Site | undefined,
  currentPlot: Plot | undefined,
  currentCensus: OrgCensus | undefined,
  setSelectableOpts: Dispatch<SetStateAction<any>>,
  signal?: AbortSignal
) {
  // Validate required parameters
  if (!currentSite?.schemaName) {
    console.warn('loadSelectableOptions: Site not selected, skipping fetch');
    return;
  }

  const plotID = currentPlot?.plotID ?? 0;
  const censusNumber = currentCensus?.plotCensusNumber ?? 0;
  const schema = currentSite.schemaName;

  // Fetch all options in parallel with proper error handling
  const [codeOpts, tagOpts, stemOpts, quadOpts, specOpts] = await Promise.all([
    fetchAndMapOptions<AttributesRDS, AttributesResult>(
      `/api/fetchall/attributes/${plotID}/${censusNumber}?schema=${schema}`,
      'attributes',
      i => i.code,
      signal
    ),
    fetchAndMapOptions<TreeRDS, TreeResult>(`/api/fetchall/trees/${plotID}/${censusNumber}?schema=${schema}`, 'trees', i => i.treeTag, signal),
    fetchAndMapOptions<StemRDS, StemResult>(`/api/fetchall/stems/${plotID}/${censusNumber}?schema=${schema}`, 'stems', i => i.stemTag, signal),
    fetchAndMapOptions<QuadratRDS, QuadratResult>(`/api/fetchall/quadrats/${plotID}/${censusNumber}?schema=${schema}`, 'quadrats', i => i.quadratName, signal),
    fetchAndMapOptions<SpeciesRDS, SpeciesResult>(`/api/fetchall/species/${plotID}/${censusNumber}?schema=${schema}`, 'species', i => i.speciesCode, signal)
  ]);

  // Check if request was aborted before updating state
  if (signal?.aborted) {
    return;
  }

  setSelectableOpts((prev: any) => {
    return {
      ...prev,
      treeTag: tagOpts,
      stemTag: stemOpts,
      quadratName: quadOpts,
      speciesCode: specOpts,
      codes: codeOpts
    };
  });
}

export function selectableAutocomplete(params: any, column: GridColDef, selectableOpts: any) {
  return (
    <Autocomplete
      sx={{ display: 'flex', flex: 1, width: '100%', height: '100%' }}
      multiple={column.field === 'codes'}
      variant={'soft'}
      autoSelect
      autoHighlight
      freeSolo={column.field !== 'codes'}
      clearOnBlur={false}
      isOptionEqualToValue={(option, value) => option === value}
      options={[...getSelectableOptionsForField(selectableOpts, column.field)].sort((a, b) => a.localeCompare(b))}
      value={
        column.field === 'codes' ? (params.value ? (params.value ?? '').split(';').filter((s: string | any[]) => s.length > 0) : []) : (params.value ?? '')
      }
      onChange={(_event, value) => {
        if (value) {
          params.api.setEditCellValue({
            id: params.id,
            field: params.field,
            value: column.field === 'codes' && Array.isArray(value) ? value.join(';') : value
          });
        }
      }}
    />
  );
}
