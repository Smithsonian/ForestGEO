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

export function LinearProgressWithLabel(props: LinearProgressProps & { value?: number; currentlyrunningmsg?: string }) {
  return (
    <Box sx={{ display: 'flex', flex: 1, alignItems: 'center', flexDirection: 'column' }}>
      <Box sx={{ width: '100%', mr: 1 }}>
        {props.value ? <LinearProgress variant="determinate" {...props} /> : <LinearProgress variant={'indeterminate'} {...props} />}
      </Box>
      <Box sx={{ minWidth: 35, display: 'flex', flex: 1, flexDirection: 'column' }}>
        {props.value ? (
          <Typography variant="body2" color="text.secondary">{`${Math.round(props?.value)}% --> ${props?.currentlyrunningmsg}`}</Typography>
        ) : (
          <Typography variant="body2" color="text.secondary">{`${props?.currentlyrunningmsg}`}</Typography>
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

export async function loadSelectableOptions(currentSite: Site, currentPlot: Plot, currentCensus: OrgCensus, setSelectableOpts: Dispatch<SetStateAction<any>>) {
  const codeOpts = MapperFactory.getMapper<AttributesRDS, AttributesResult>('attributes')
    .mapData(
      await (
        await fetch(`/api/fetchall/attributes/${currentPlot?.plotID ?? 0}/${currentCensus?.plotCensusNumber ?? 0}?schema=${currentSite?.schemaName ?? ''}`)
      ).json()
    )
    .map(i => i.code)
    .filter((code): code is string => code !== null && code !== undefined && code?.trim().length > 0)
    .sort((a, b) => a.localeCompare(b));
  const tagOpts = MapperFactory.getMapper<TreeRDS, TreeResult>('trees')
    .mapData(
      await (
        await fetch(`/api/fetchall/trees/${currentPlot?.plotID ?? 0}/${currentCensus?.plotCensusNumber ?? 0}?schema=${currentSite?.schemaName ?? ''}`)
      ).json()
    )
    .map(i => i.treeTag)
    .filter((code): code is string => code !== null && code !== undefined && code?.trim().length > 0)
    .sort((a, b) => a.localeCompare(b));
  const stemOpts = MapperFactory.getMapper<StemRDS, StemResult>('stems')
    .mapData(
      await (
        await fetch(`/api/fetchall/stems/${currentPlot?.plotID ?? 0}/${currentCensus?.plotCensusNumber ?? 0}?schema=${currentSite?.schemaName ?? ''}`)
      ).json()
    )
    .map(i => i.stemTag)
    .filter((code): code is string => code !== null && code !== undefined && code?.trim().length > 0)
    .sort((a, b) => a.localeCompare(b));
  const quadOpts = MapperFactory.getMapper<QuadratRDS, QuadratResult>('quadrats')
    .mapData(
      await (
        await fetch(`/api/fetchall/quadrats/${currentPlot?.plotID ?? 0}/${currentCensus?.plotCensusNumber ?? 0}?schema=${currentSite?.schemaName ?? ''}`)
      ).json()
    )
    .map(i => i.quadratName)
    .filter((code): code is string => code !== null && code !== undefined && code?.trim().length > 0)
    .sort((a, b) => a.localeCompare(b));
  const specOpts = MapperFactory.getMapper<SpeciesRDS, SpeciesResult>('species')
    .mapData(
      await (
        await fetch(`/api/fetchall/species/${currentPlot?.plotID ?? 0}/${currentCensus?.plotCensusNumber ?? 0}?schema=${currentSite?.schemaName ?? ''}`)
      ).json()
    )
    .map(i => i.speciesCode)
    .filter((code): code is string => code !== null && code !== undefined && code?.trim().length > 0)
    .sort((a, b) => a.localeCompare(b));
  setSelectableOpts((prev: any) => {
    return {
      ...prev,
      tag: tagOpts,
      stemTag: stemOpts,
      quadrat: quadOpts,
      spCode: specOpts,
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
      options={[...(selectableOpts[column.field] || [])].sort((a, b) => a.localeCompare(b))}
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
