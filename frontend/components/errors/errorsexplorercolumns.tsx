'use client';

import React from 'react';
import { Chip, Stack, Typography } from '@mui/joy';
import {
  getGridNumericOperators,
  getGridStringOperators,
  GridActionsCellItem,
  GridRowModes,
  type GridActionsCellItemProps,
  type GridColDef,
  type GridColumnVisibilityModel,
  type GridFilterOperator,
  type GridRowModesModel
} from '@mui/x-data-grid';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Close';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import CallSplitIcon from '@mui/icons-material/CallSplit';
import {
  CONTRADICTION_LABELS,
  DBH_CHANGE_VALIDATION_CODES,
  ERROR_EXPLORER_NUMBER_OPERATORS,
  ERROR_EXPLORER_TEXT_OPERATORS,
  formatDbhChange,
  formatMoreErrors,
  formatPriorDbhHeader,
  isErrorExplorerColumnField,
  isErrorExplorerNumberField,
  VIEW_ERRORS_TEXT,
  type ErrorExplorerRow,
  type ErrorTypeFacet
} from '@/config/errorsexplorer';
import type { OrgCensus } from '@/lib/db/definitions/timekeeping';
import {
  CodesEditCell,
  formatOptionalMeasurement,
  getCodesMismatchMessage,
  getDisplayedContradictionTypes,
  getUploadedCodesValue,
  renderCodesChips,
  renderPreviewCell
} from './errorcodes';

export const ERRORS_ACTIONS_FIELD = 'actions';
export const ERRORS_LABEL_FIELD = 'errors';
export const FAULTED_CELL_CLASS = 'errors-explorer-faulted-cell';
const EDITOR_ACTIONS_WIDTH = 112;
const READ_ONLY_ACTIONS_WIDTH = 80;
const PREVIEW_LINES = 2;
const COORDINATE_FRACTION_DIGITS = 2;
const DISABLED_ACTION_OPACITY = 0.4;

const TEXT_FILTER_OPERATORS: GridFilterOperator[] = getGridStringOperators().filter(operator =>
  (ERROR_EXPLORER_TEXT_OPERATORS as readonly string[]).includes(operator.value)
);
const NUMBER_FILTER_OPERATORS: GridFilterOperator[] = getGridNumericOperators().filter(operator =>
  (ERROR_EXPLORER_NUMBER_OPERATORS as readonly string[]).includes(operator.value)
);

export const GROUP_ALWAYS_VISIBLE_FIELDS = [
  ERRORS_ACTIONS_FIELD,
  ERRORS_LABEL_FIELD,
  'treeTag',
  'stemTag',
  'speciesCode',
  'quadratName',
  'measurementDate'
] as const;
const GROUP_OPTIONAL_FIELDS = [
  'attributes',
  'stemLocalX',
  'stemLocalY',
  'stemPlotX',
  'stemPlotY',
  'measuredDBH',
  'measuredHOM',
  'priorDBH',
  'dbhChangePercent',
  'priorHOM',
  'homChanged',
  'description'
] as const;
const DBH_CHANGE_COLUMNS = ['priorDBH', 'measuredDBH', 'dbhChangePercent'] as const;

/** The flat grid's defaults: today's hidden set plus the new Change column (#525 item 7). */
export const ERRORS_EXPLORER_DEFAULT_HIDDEN_COLUMNS: GridColumnVisibilityModel = {
  stemPlotX: false,
  stemPlotY: false,
  priorDBH: false,
  dbhChangePercent: false,
  priorHOM: false,
  homChanged: false
};

export interface ErrorsExplorerRowActions {
  onOpenDetails: (row: ErrorExplorerRow) => void;
  onStartEdit: (rowID: number) => void;
  onSave: (rowID: number) => void;
  onCancel: (rowID: number) => void;
  editDisabledReason: (rowID: number) => string | null;
  detailsDisabledReason: (rowID: number) => string | null;
}

export interface ErrorsExplorerColumnOptions {
  canEditRows: boolean;
  canEditSpeciesCode: boolean;
  codeOptions: readonly string[];
  rowModesModel: GridRowModesModel;
  /** The owning grid's lock tooltip, shown on its sortable/filterable headers (P2-15); null when not locked. */
  lockedHeaderDescription: string | null;
  faultedFieldsFor: (row: ErrorExplorerRow) => ReadonlySet<string>;
  errorLabelFor: (row: ErrorExplorerRow) => string;
  priorDbhHeader: string;
  actions: ErrorsExplorerRowActions;
}

function formatCoordinate(value: number | string | null | undefined): string {
  return value == null || value === '' ? '' : Number(value).toFixed(COORDINATE_FRACTION_DIGITS);
}

function formatFixedMeasurement(value: number | null | undefined): string {
  return Number(value ?? 0).toFixed(COORDINATE_FRACTION_DIGITS);
}

function actionItem(
  key: string,
  label: string,
  icon: React.ReactElement,
  disabledReason: string | null,
  onActivate: () => void
): React.ReactElement<GridActionsCellItemProps> {
  return (
    <GridActionsCellItem
      key={key}
      icon={icon}
      label={label}
      aria-disabled={disabledReason ? true : undefined}
      title={disabledReason ?? undefined}
      onClick={disabledReason ? undefined : onActivate}
      style={disabledReason ? { opacity: DISABLED_ACTION_OPACITY, cursor: 'not-allowed' } : undefined}
    />
  );
}

function ErrorsCell({ row, label }: { row: ErrorExplorerRow; label: string }) {
  const more = formatMoreErrors(row.totalErrorCount);
  return (
    <Stack spacing={0.25} sx={{ py: 0.5, minWidth: 0 }}>
      {renderPreviewCell(label, PREVIEW_LINES)}
      <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
        {more && (
          <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
            {more}
          </Typography>
        )}
        {getDisplayedContradictionTypes(row).map(type => (
          <Chip key={type} size="sm" color="warning" startDecorator={<CallSplitIcon />}>
            {CONTRADICTION_LABELS[type]}
          </Chip>
        ))}
      </Stack>
    </Stack>
  );
}

export function buildErrorsExplorerColumns(options: ErrorsExplorerColumnOptions): GridColDef[] {
  const { canEditRows, canEditSpeciesCode, codeOptions, rowModesModel, lockedHeaderDescription, faultedFieldsFor, errorLabelFor, priorDbhHeader, actions } =
    options;
  const sortedCodeOptions = [...codeOptions].sort((a, b) => a.localeCompare(b));

  const faulted = (field: string) => (params: { row: ErrorExplorerRow }) => (faultedFieldsFor(params.row).has(field) ? FAULTED_CELL_CLASS : '');
  const serverColumn = (definition: GridColDef): GridColDef => {
    const field = definition.field;
    const onAllowList = isErrorExplorerColumnField(field);
    return {
      ...definition,
      sortable: onAllowList,
      filterable: onAllowList,
      ...(onAllowList ? { filterOperators: isErrorExplorerNumberField(field) ? NUMBER_FILTER_OPERATORS : TEXT_FILTER_OPERATORS } : {}),
      ...(onAllowList && lockedHeaderDescription ? { description: lockedHeaderDescription } : {}),
      cellClassName: faulted(field) as GridColDef['cellClassName']
    };
  };

  const actionsColumn: GridColDef = {
    field: ERRORS_ACTIONS_FIELD,
    type: 'actions',
    headerName: canEditRows ? VIEW_ERRORS_TEXT.actionsColumn : VIEW_ERRORS_TEXT.detailsColumn,
    width: canEditRows ? EDITOR_ACTIONS_WIDTH : READ_ONLY_ACTIONS_WIDTH,
    disableColumnMenu: false,
    hideable: false,
    sortable: false,
    filterable: false,
    getActions: ({ id, row }) => {
      const rowID = Number(id);
      const explorerRow = row as ErrorExplorerRow;
      const details = actionItem('details', VIEW_ERRORS_TEXT.detailsAction, <InfoOutlinedIcon />, actions.detailsDisabledReason(rowID), () =>
        actions.onOpenDetails(explorerRow)
      );
      if (!canEditRows) return [details];
      if (rowModesModel[id]?.mode === GridRowModes.Edit) {
        return [
          details,
          actionItem('save', VIEW_ERRORS_TEXT.saveAction, <SaveIcon />, null, () => actions.onSave(rowID)),
          actionItem('cancel', VIEW_ERRORS_TEXT.cancelAction, <CancelIcon />, null, () => actions.onCancel(rowID))
        ];
      }
      return [details, actionItem('edit', VIEW_ERRORS_TEXT.editAction, <EditIcon />, actions.editDisabledReason(rowID), () => actions.onStartEdit(rowID))];
    }
  };

  return [
    actionsColumn,
    {
      field: ERRORS_LABEL_FIELD,
      headerName: VIEW_ERRORS_TEXT.errorsColumn,
      minWidth: 240,
      flex: 1.4,
      sortable: false,
      filterable: false,
      editable: false,
      headerAlign: 'left',
      align: 'left',
      renderCell: params => <ErrorsCell row={params.row as ErrorExplorerRow} label={errorLabelFor(params.row as ErrorExplorerRow)} />
    },
    {
      field: 'attributes',
      headerName: 'Codes',
      minWidth: 160,
      flex: 0.9,
      sortable: false,
      filterable: false,
      editable: canEditRows,
      headerAlign: 'left',
      align: 'left',
      cellClassName: faulted('attributes') as GridColDef['cellClassName'],
      renderCell: params => {
        const row = params.row as ErrorExplorerRow;
        const mismatchMessage = getCodesMismatchMessage(row);
        return (
          <Stack spacing={0.25} sx={{ py: 0.5 }}>
            {renderCodesChips(getUploadedCodesValue(row))}
            {mismatchMessage ? (
              <Typography level="body-xs" color="warning" sx={{ whiteSpace: 'normal', lineHeight: 1.2 }}>
                {mismatchMessage}
              </Typography>
            ) : null}
          </Stack>
        );
      },
      renderEditCell: params => <CodesEditCell params={params} options={sortedCodeOptions} />
    },
    serverColumn({ field: 'treeTag', headerName: 'Tree Tag', minWidth: 110, flex: 0.7, editable: canEditRows, headerAlign: 'left', align: 'left' }),
    serverColumn({ field: 'stemTag', headerName: 'Stem Tag', minWidth: 110, flex: 0.7, editable: canEditRows, headerAlign: 'left', align: 'left' }),
    serverColumn({
      field: 'speciesCode',
      headerName: 'Species',
      minWidth: 110,
      flex: 0.7,
      editable: canEditRows && canEditSpeciesCode,
      headerAlign: 'left',
      align: 'left'
    }),
    serverColumn({ field: 'quadratName', headerName: 'Quadrat', minWidth: 110, flex: 0.7, editable: canEditRows, headerAlign: 'left', align: 'left' }),
    serverColumn({ field: 'measurementDate', headerName: 'Date', minWidth: 120, flex: 0.8, editable: canEditRows, headerAlign: 'left', align: 'left' }),
    serverColumn({
      field: 'stemLocalX',
      headerName: 'X',
      width: 80,
      type: 'number',
      editable: canEditRows,
      align: 'right',
      headerAlign: 'right',
      valueFormatter: formatFixedMeasurement
    }),
    serverColumn({
      field: 'stemLocalY',
      headerName: 'Y',
      width: 80,
      type: 'number',
      editable: canEditRows,
      align: 'right',
      headerAlign: 'right',
      valueFormatter: formatFixedMeasurement
    }),
    serverColumn({
      field: 'stemPlotX',
      headerName: 'Plot X',
      width: 105,
      type: 'number',
      editable: false,
      align: 'right',
      headerAlign: 'right',
      valueFormatter: formatCoordinate
    }),
    serverColumn({
      field: 'stemPlotY',
      headerName: 'Plot Y',
      width: 105,
      type: 'number',
      editable: false,
      align: 'right',
      headerAlign: 'right',
      valueFormatter: formatCoordinate
    }),
    serverColumn({
      field: 'measuredDBH',
      headerName: 'DBH',
      width: 100,
      type: 'number',
      editable: canEditRows,
      align: 'right',
      headerAlign: 'right',
      valueFormatter: formatFixedMeasurement
    }),
    serverColumn({
      field: 'measuredHOM',
      headerName: 'HOM',
      width: 100,
      type: 'number',
      editable: canEditRows,
      align: 'right',
      headerAlign: 'right',
      valueFormatter: formatFixedMeasurement
    }),
    serverColumn({
      field: 'priorDBH',
      headerName: priorDbhHeader,
      width: 140,
      type: 'number',
      editable: false,
      align: 'right',
      headerAlign: 'right',
      valueFormatter: formatOptionalMeasurement
    }),
    serverColumn({
      field: 'dbhChangePercent',
      headerName: VIEW_ERRORS_TEXT.changeColumn,
      width: 100,
      type: 'number',
      editable: false,
      align: 'right',
      headerAlign: 'right',
      valueFormatter: formatDbhChange
    }),
    {
      field: 'priorHOM',
      headerName: 'Prior HOM',
      width: 100,
      type: 'number',
      editable: false,
      sortable: false,
      filterable: false,
      align: 'right',
      headerAlign: 'right',
      valueFormatter: formatOptionalMeasurement
    },
    {
      field: 'homChanged',
      headerName: 'HOM Changed',
      width: 130,
      editable: false,
      sortable: false,
      filterable: false,
      align: 'center',
      headerAlign: 'center',
      renderCell: params =>
        (params.row as ErrorExplorerRow).homChanged ? (
          <Chip size="sm" color="warning" variant="soft">
            HOM changed
          </Chip>
        ) : null
    },
    serverColumn({
      field: 'description',
      headerName: 'Description',
      minWidth: 220,
      flex: 1.1,
      editable: canEditRows,
      headerAlign: 'left',
      align: 'left',
      renderCell: params => renderPreviewCell(params.value as string | undefined, PREVIEW_LINES)
    })
  ];
}

export function buildGroupColumnVisibility(facet: Pick<ErrorTypeFacet, 'source' | 'code' | 'fields'>): GridColumnVisibilityModel {
  const visible = new Set<string>(facet.fields.filter(field => (GROUP_OPTIONAL_FIELDS as readonly string[]).includes(field)));
  if (facet.source === 'validation' && DBH_CHANGE_VALIDATION_CODES.has(facet.code)) DBH_CHANGE_COLUMNS.forEach(field => visible.add(field));
  return Object.fromEntries(GROUP_OPTIONAL_FIELDS.map(field => [field, visible.has(field)]));
}

export function resolvePriorDbhHeader(rows: ReadonlyArray<Pick<ErrorExplorerRow, 'priorCensusID'>>, censusList: OrgCensus[] | undefined): string {
  const priorCensusIDs = new Set(rows.map(row => row.priorCensusID).filter((id): id is number => typeof id === 'number'));
  if (!censusList || priorCensusIDs.size === 0) return formatPriorDbhHeader(null);
  const plotCensusNumbers = new Set<number>();
  for (const priorCensusID of priorCensusIDs) {
    const census = censusList.find(entry => entry?.censusIDs.includes(priorCensusID));
    if (!census) return formatPriorDbhHeader(null);
    plotCensusNumbers.add(census.plotCensusNumber);
  }
  return plotCensusNumbers.size === 1 ? formatPriorDbhHeader([...plotCensusNumbers][0]) : formatPriorDbhHeader(null);
}
