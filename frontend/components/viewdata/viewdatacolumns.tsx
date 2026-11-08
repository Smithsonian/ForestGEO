'use client';

import React from 'react';
import {
  getGridBooleanOperators,
  getGridDateOperators,
  getGridNumericOperators,
  getGridSingleSelectOperators,
  getGridStringOperators,
  type GridColDef,
  type GridFilterOperator,
  type GridRenderCellParams,
  type GridRowsProp,
  type GridValidRowModel
} from '@mui/x-data-grid';
import { Chip, Stack, Tooltip, Typography } from '@mui/joy';
import CheckIcon from '@mui/icons-material/Check';
import ScheduleIcon from '@mui/icons-material/Schedule';
import CallSplitIcon from '@mui/icons-material/CallSplit';
import { formatMeasurementDateCell, measurementDateValueGetter, measurementDateValueSetter } from '@/components/datagrids/measurementdatecolumn';
import { ErrorSourceChip } from '@/components/errors/errorsourcechip';
import { AttributeStatusOptions } from '@/lib/db/definitions/core';
import {
  ALL_TREE_STEM_STATES,
  describeValidationCell,
  EMPTY_CELL_DISPLAY,
  formatStemState,
  formatStemStatuses,
  isViewDataFilterableField,
  isViewDataSortableField,
  parseStemStatuses,
  STEM_STATE_LABELS,
  STEM_STATUS_LABELS,
  toViewDataRowSummary,
  VIEW_DATA_COLUMN_HEADERS,
  VIEW_DATA_COLUMN_WIDTHS,
  VIEW_DATA_DATA_FIELD_ORDER,
  VIEW_DATA_DEFAULT_COLUMN_WIDTH,
  VIEW_DATA_FIELDS,
  VIEW_DATA_FILTER_OPERATOR_VALUES,
  VIEW_DATA_TEXT,
  type ViewDataFieldFaults
} from '@/config/viewdata';

const NUMERIC_FIELDS: ReadonlySet<string> = new Set(['stemLocalX', 'stemLocalY', 'stemPlotX', 'stemPlotY', 'measuredDBH', 'measuredHOM']);
const NUMERIC_FRACTION_DIGITS = 2;
const FAULT_FONT_WEIGHT = 600;
const IS_OPERATOR = 'is';
const NEVER_EDITABLE_FIELDS: ReadonlySet<string> = new Set([VIEW_DATA_FIELDS.measurementStatus, VIEW_DATA_FIELDS.stemState, VIEW_DATA_FIELDS.stemStatus]);
const ALWAYS_SHOWN_FIELDS: ReadonlySet<string> = new Set([VIEW_DATA_FIELDS.actions, VIEW_DATA_FIELDS.measurementStatus]);
const HIDE_EMPTY_VALUE_KEYS: Readonly<Record<string, string>> = { stemState: 'userDefinedFields', stemStatus: 'stemStatuses' };
const CODES_SEPARATOR = /\s*;\s*/;

const isOnlyOperators = () => getGridSingleSelectOperators().filter(operator => operator.value === IS_OPERATOR);

function defaultFilterOperatorsFor(type: GridColDef['type']): GridFilterOperator[] {
  switch (type) {
    case 'number':
      return getGridNumericOperators();
    case 'date':
      return getGridDateOperators();
    case 'dateTime':
      return getGridDateOperators(true);
    case 'singleSelect':
      return getGridSingleSelectOperators();
    case 'boolean':
      return getGridBooleanOperators();
    default:
      return getGridStringOperators();
  }
}

/** The server rejects an operator buildFilterModelStub does not implement (400), so the Filters panel never offers one. */
const serverSupportedOperators = (column: GridColDef): GridFilterOperator[] =>
  (column.filterOperators ?? defaultFilterOperatorsFor(column.type)).filter(operator => VIEW_DATA_FILTER_OPERATOR_VALUES.has(operator.value));

export function ValidationCell({ row }: { row: GridValidRowModel }) {
  const cell = describeValidationCell(toViewDataRowSummary(row));
  return (
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0, width: '100%' }} data-testid="validation-cell">
      {cell.source && <ErrorSourceChip source={cell.source} />}
      {cell.status === 'pending' && <ScheduleIcon fontSize="small" aria-hidden />}
      {cell.status === 'passed' && <CheckIcon fontSize="small" color="success" aria-hidden />}
      <Typography level="body-sm" noWrap title={cell.title} sx={{ minWidth: 0, flex: 1 }}>
        {cell.text}
      </Typography>
      {cell.extraErrorCount > 0 && (
        <Tooltip
          title={
            <Stack>
              {cell.extraErrorLines.map((line, index) => (
                <span key={`${index}-${line}`}>{line}</span>
              ))}
            </Stack>
          }
        >
          <Chip size="sm" variant="outlined">
            {VIEW_DATA_TEXT.moreErrors(cell.extraErrorCount)}
          </Chip>
        </Tooltip>
      )}
      {cell.hasContradiction && (
        <CallSplitIcon fontSize="small" color="warning" titleAccess={VIEW_DATA_TEXT.contradictionIcon} aria-label={VIEW_DATA_TEXT.contradictionIcon} />
      )}
    </Stack>
  );
}

function formatCellText(field: string, params: GridRenderCellParams): string {
  if (field === VIEW_DATA_FIELDS.measurementDate) {
    const formatted = formatMeasurementDateCell(params.value);
    return formatted ? String(formatted) : EMPTY_CELL_DISPLAY;
  }
  const value = params.value;
  if (value === null || value === undefined || value === '') return EMPTY_CELL_DISPLAY;
  if (NUMERIC_FIELDS.has(field)) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric.toFixed(NUMERIC_FRACTION_DIGITS) : String(value);
  }
  return String(value);
}

function FaultableCell({
  params,
  fault,
  isFaulted,
  attributeTooltips
}: {
  params: GridRenderCellParams;
  fault: string | null | undefined;
  isFaulted: boolean;
  attributeTooltips: ReadonlyMap<string, string>;
}) {
  const style = isFaulted ? { color: 'warning.plainColor', fontWeight: FAULT_FONT_WEIGHT } : undefined;
  if (params.field === VIEW_DATA_FIELDS.attributes && typeof params.value === 'string' && params.value.trim() !== '') {
    const codes = params.value.split(CODES_SEPARATOR).filter(Boolean);
    const chips = (
      <Stack direction="row" spacing={0.5} sx={{ overflow: 'hidden' }} data-faulted={isFaulted ? 'true' : undefined}>
        {codes.map(code => (
          <Tooltip key={code} title={attributeTooltips.get(code) ?? code} size="sm" variant="soft">
            <Chip size="sm" color={isFaulted ? 'warning' : 'neutral'} sx={isFaulted ? { fontWeight: FAULT_FONT_WEIGHT } : undefined}>
              {code}
            </Chip>
          </Tooltip>
        ))}
      </Stack>
    );
    return fault ? <Tooltip title={fault}>{chips}</Tooltip> : chips;
  }
  const text = (
    <Typography level="body-sm" noWrap sx={style} data-faulted={isFaulted ? 'true' : undefined}>
      {formatCellText(params.field, params)}
    </Typography>
  );
  return fault ? <Tooltip title={fault}>{text}</Tooltip> : text;
}

export interface BuildViewDataColumnsInput {
  /** Base summary columns, already carrying MeasurementsCommons' edit components. */
  dataColumns: GridColDef[];
  actionsColumn: GridColDef;
  canEditRows: boolean;
  canEditSpeciesCode: boolean;
  faultsForRow: (row: GridValidRowModel) => ViewDataFieldFaults;
  /** Stem code → tooltip text (description and status), as the Codes cell shows today. */
  attributeTooltips: ReadonlyMap<string, string>;
}

function buildMeasurementDateColumn(): GridColDef {
  return {
    field: VIEW_DATA_FIELDS.measurementDate,
    type: 'date',
    editable: true,
    valueGetter: value => measurementDateValueGetter(value),
    valueSetter: (value, row) => measurementDateValueSetter(value, row),
    valueFormatter: value => formatMeasurementDateCell(value)
  };
}

export function buildViewDataColumns({
  dataColumns,
  actionsColumn,
  canEditRows,
  canEditSpeciesCode,
  faultsForRow,
  attributeTooltips
}: BuildViewDataColumnsInput): GridColDef[] {
  const byField = new Map(dataColumns.map(column => [column.field, column]));
  byField.set(VIEW_DATA_FIELDS.measurementDate, { ...buildMeasurementDateColumn(), ...(byField.get(VIEW_DATA_FIELDS.measurementDate) ?? {}) });

  const decorate = (column: GridColDef): GridColDef => {
    const field = column.field;
    const fieldEditable =
      Boolean(column.editable) && canEditRows && !NEVER_EDITABLE_FIELDS.has(field) && (field !== VIEW_DATA_FIELDS.speciesCode || canEditSpeciesCode);
    return {
      ...column,
      flex: undefined,
      width: VIEW_DATA_COLUMN_WIDTHS[field] ?? column.width ?? VIEW_DATA_DEFAULT_COLUMN_WIDTH,
      headerName: VIEW_DATA_COLUMN_HEADERS[field] ?? column.headerName,
      renderHeader: undefined,
      sortable: isViewDataSortableField(field),
      filterable: isViewDataFilterableField(field),
      filterOperators: serverSupportedOperators(column),
      editable: fieldEditable,
      renderCell: (params: GridRenderCellParams) => {
        const faults = faultsForRow(params.row);
        return <FaultableCell params={params} fault={faults.get(field)} isFaulted={faults.has(field)} attributeTooltips={attributeTooltips} />;
      }
    };
  };

  const validationColumn: GridColDef = {
    field: VIEW_DATA_FIELDS.measurementStatus,
    headerName: VIEW_DATA_COLUMN_HEADERS.measurementStatus,
    width: VIEW_DATA_COLUMN_WIDTHS.measurementStatus,
    sortable: true,
    filterable: false,
    editable: false,
    valueGetter: (_value, row) => toViewDataRowSummary(row).measurementStatus,
    renderCell: params => <ValidationCell row={params.row} />
  };

  const stemStateColumn: GridColDef = {
    field: VIEW_DATA_FIELDS.stemState,
    headerName: VIEW_DATA_COLUMN_HEADERS.stemState,
    width: VIEW_DATA_COLUMN_WIDTHS.stemState,
    type: 'singleSelect',
    valueOptions: ALL_TREE_STEM_STATES.map(state => ({ value: state, label: STEM_STATE_LABELS[state] })),
    filterOperators: isOnlyOperators(),
    sortable: true,
    editable: false,
    valueGetter: (_value, row) => row.userDefinedFields ?? null,
    renderCell: params => (
      <Typography level="body-sm" textColor="text.tertiary" noWrap>
        {formatStemState(params.value)}
      </Typography>
    )
  };

  const stemStatusColumn: GridColDef = {
    field: VIEW_DATA_FIELDS.stemStatus,
    headerName: VIEW_DATA_COLUMN_HEADERS.stemStatus,
    width: VIEW_DATA_COLUMN_WIDTHS.stemStatus,
    type: 'singleSelect',
    valueOptions: AttributeStatusOptions.map(status => ({ value: status, label: STEM_STATUS_LABELS[status] ?? status })),
    filterOperators: isOnlyOperators(),
    sortable: false,
    editable: false,
    valueGetter: (_value, row) => parseStemStatuses(row.stemStatuses),
    renderCell: params => (
      <Typography level="body-sm" noWrap>
        {formatStemStatuses(Array.isArray(params.value) ? params.value : [])}
      </Typography>
    )
  };

  const ordered: GridColDef[] = [actionsColumn, validationColumn, stemStateColumn];
  const placed = new Set<string>(ordered.map(column => column.field));
  for (const field of VIEW_DATA_DATA_FIELD_ORDER) {
    if (field === VIEW_DATA_FIELDS.stemStatus) {
      ordered.push(stemStatusColumn);
    } else {
      const base = byField.get(field);
      if (!base) continue;
      ordered.push(decorate(base));
    }
    placed.add(field);
  }
  for (const column of dataColumns) {
    if (placed.has(column.field)) continue;
    ordered.push({ ...column, flex: undefined, width: column.width ?? VIEW_DATA_DEFAULT_COLUMN_WIDTH, sortable: false, filterable: false, editable: false });
  }
  return ordered;
}

function isBlankCellValue(value: unknown): boolean {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

/** "Hide empty columns", judged per loaded page as today, reading the row key each derived column displays. */
export function hideEmptyViewDataColumns(rows: GridRowsProp, columns: GridColDef[]): GridColDef[] {
  return columns.filter(column => {
    if (ALWAYS_SHOWN_FIELDS.has(column.field)) return true;
    const key = HIDE_EMPTY_VALUE_KEYS[column.field] ?? column.field;
    return rows.some(row => !isBlankCellValue((row as Record<string, unknown>)[key]));
  });
}
