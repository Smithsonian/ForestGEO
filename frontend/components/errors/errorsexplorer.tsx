'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  Alert,
  Autocomplete,
  Button,
  Card,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  FormLabel,
  Input,
  Option,
  Select,
  Sheet,
  Stack,
  Switch,
  Typography
} from '@mui/joy';
import {
  GridActionsCellItem,
  GridColDef,
  GridEventListener,
  GridPaginationModel,
  GridRowEditStopReasons,
  GridRowModes,
  GridRowModesModel,
  GridRowModel
} from '@mui/x-data-grid';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Close';
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined';
import CallSplitIcon from '@mui/icons-material/CallSplit';
import {
  ContradictionType,
  CONTRADICTION_LABELS,
  DEFAULT_ERROR_EXPLORER_FILTERS,
  ErrorExplorerDetailsResponse,
  ErrorExplorerFacetsResponse,
  ErrorExplorerFilters,
  ErrorExplorerQueryResponse,
  ErrorExplorerRow,
  ERROR_EXPLORER_PRESETS
} from '@/config/errorsexplorer';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/compat-hooks';
import { StyledDataGrid } from '@/config/styleddatagrid';
import ContradictionComparisonPanel from './contradictioncomparisonpanel';
import { loadSelectableOptions } from '@/components/client/clientmacros';
import { useEditPreviewFlow } from '@/hooks/useEditPreviewFlow';
import { isMuiRowEditCancelled } from '@/lib/muirowedit';
import PreviewDialog from '@/components/editplan/previewdialog';
import UndoToast from '@/components/editplan/undotoast';
import { buildEditableFieldsDiffWithMetaForSurface } from '@/components/datagrids/measurementscommonsutils';
import { isFieldEditableByRole } from '@/config/editplan/fieldpolicy';

const DEFAULT_FACETS: ErrorExplorerFacetsResponse = {
  messages: [],
  fields: [],
  sourceCounts: {
    validation: 0,
    ingestion: 0
  },
  contradictionCounts: {
    duplicateTagStem: 0,
    sameBatchConflict: 0
  }
};

const DEFAULT_RESULTS: ErrorExplorerQueryResponse = {
  rows: [],
  totalRows: 0,
  summary: {
    total: 0,
    validation: 0,
    ingestion: 0,
    contradictions: 0,
    duplicateTagStem: 0,
    sameBatchConflict: 0
  }
};

function stripRowForUpdate(row: ErrorExplorerRow) {
  return {
    id: row.id,
    coreMeasurementID: row.coreMeasurementID,
    plotID: row.plotID,
    censusID: row.censusID,
    quadratID: row.quadratID,
    treeID: row.treeID,
    stemGUID: row.stemGUID,
    speciesID: row.speciesID,
    quadratName: row.quadratName,
    speciesName: row.speciesName,
    subspeciesName: row.subspeciesName,
    speciesCode: row.speciesCode,
    treeTag: row.treeTag,
    stemTag: row.stemTag,
    stemLocalX: row.stemLocalX,
    stemLocalY: row.stemLocalY,
    measurementDate: row.measurementDate,
    measuredDBH: row.measuredDBH,
    measuredHOM: row.measuredHOM,
    isValidated: row.isValidated,
    description: row.description,
    attributes: row.attributes,
    userDefinedFields: row.userDefinedFields,
    isFailedRow: row.isFailedRow
  };
}

interface ExplorerScope {
  schema: string;
  plotID: number;
  censusID: number;
}

function getFilterStorageKey(schema?: string, plotID?: number, censusID?: number) {
  if (!schema || !plotID || !censusID) return null;
  return `errors-explorer-filters:${schema}:${plotID}:${censusID}`;
}

function renderPreviewCell(value: string | null | undefined, lines = 2) {
  const displayValue = value && value.trim().length > 0 ? value : '—';

  return (
    <Typography
      level="body-sm"
      title={displayValue}
      sx={{
        width: '100%',
        overflow: 'hidden',
        display: '-webkit-box',
        WebkitBoxOrient: 'vertical',
        WebkitLineClamp: lines,
        whiteSpace: 'normal',
        textAlign: 'left',
        lineHeight: 1.35
      }}
    >
      {displayValue}
    </Typography>
  );
}

function getDisplayedContradictionTypes(row: Pick<ErrorExplorerRow, 'contradictionTypes' | 'contradictionType'>): ContradictionType[] {
  if (row.contradictionTypes.length > 0) {
    return row.contradictionTypes;
  }
  return row.contradictionType ? [row.contradictionType] : [];
}

type CodesRow = Pick<ErrorExplorerRow, 'attributes' | 'rawCodes'>;

function normalizeCodeValue(value?: string | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function parseCodesString(raw: string | undefined | null): string[] {
  return (raw ?? '')
    .split(/[;,]/)
    .map(code => code.trim())
    .filter(Boolean);
}

export function joinCodesArray(codes: unknown): string {
  if (!Array.isArray(codes)) {
    return '';
  }

  return Array.from(new Set((codes as string[]).map(code => code.trim()).filter(Boolean))).join(';');
}

export function getUploadedCodesValue(row?: Partial<CodesRow> | null): string {
  const rawCodes = normalizeCodeValue(row?.rawCodes);
  return rawCodes || normalizeCodeValue(row?.attributes);
}

export function getMaterializedCodesValue(row?: Partial<CodesRow> | null): string {
  return normalizeCodeValue(row?.attributes);
}

export function hasCodesMismatch(row?: Partial<CodesRow> | null): boolean {
  const uploadedCodes = joinCodesArray(parseCodesString(getUploadedCodesValue(row)));
  const materializedCodes = joinCodesArray(parseCodesString(getMaterializedCodesValue(row)));

  return uploadedCodes.length > 0 && uploadedCodes !== materializedCodes;
}

function getCodesMismatchMessage(row?: Partial<CodesRow> | null): string {
  if (!hasCodesMismatch(row)) {
    return '';
  }

  return getMaterializedCodesValue(row) ? 'Some uploaded codes were not materialized.' : 'No valid codes were materialized. Check invalid codes or delimiters.';
}

function getCodesEditValue(row?: Partial<CodesRow> | null, currentValue?: string | null): string {
  const editedValue = normalizeCodeValue(currentValue);
  return editedValue || getUploadedCodesValue(row);
}

function renderCodesChips(codesValue: string, emptyLabel = '—') {
  const codes = parseCodesString(codesValue);
  if (codes.length === 0) {
    return <Typography level="body-sm">{emptyLabel}</Typography>;
  }

  return (
    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', py: 0.5 }}>
      {codes.map((code, index) => (
        <Chip key={`${code}-${index}`} size="sm" variant="soft">
          {code}
        </Chip>
      ))}
    </Stack>
  );
}

function mergeEditedRow(existingRow: ErrorExplorerRow, updatedRow: ErrorExplorerRow): ErrorExplorerRow {
  return {
    ...existingRow,
    ...stripRowForUpdate(updatedRow),
    rawCodes: updatedRow.rawCodes ?? existingRow.rawCodes
  };
}

export default function ErrorsExplorer() {
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const { data: session } = useSession();
  const activeCensusID = currentCensus?.dateRanges?.[0]?.censusID;
  // Keep the grid affordances aligned with editplan authorization: pending
  // users cannot edit, and species-code edits stay admin-only.
  const userStatus = session?.user?.userStatus;
  const canEditRows = Boolean(userStatus && userStatus !== 'pending');
  const canEditSpeciesCode = isFieldEditableByRole('SpeciesCode', userStatus);
  const storageKey = useMemo(
    () => getFilterStorageKey(currentSite?.schemaName, currentPlot?.plotID, activeCensusID),
    [currentSite?.schemaName, currentPlot?.plotID, activeCensusID]
  );
  const resolveExplorerScope = useCallback(
    (fallbackRow?: Partial<ErrorExplorerRow> | null): ExplorerScope | null => {
      if (!currentSite?.schemaName) return null;

      const fallbackPlotID = typeof fallbackRow?.plotID === 'number' && fallbackRow.plotID > 0 ? fallbackRow.plotID : null;
      const fallbackCensusID = typeof fallbackRow?.censusID === 'number' && fallbackRow.censusID > 0 ? fallbackRow.censusID : null;
      const plotID = currentPlot?.plotID ?? fallbackPlotID;
      const censusID = activeCensusID ?? fallbackCensusID;
      if (!plotID || !censusID) return null;

      return {
        schema: currentSite.schemaName,
        plotID,
        censusID
      };
    },
    [activeCensusID, currentPlot?.plotID, currentSite?.schemaName]
  );

  const [filters, setFilters] = useState<ErrorExplorerFilters>(DEFAULT_ERROR_EXPLORER_FILTERS);
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });
  const [results, setResults] = useState<ErrorExplorerQueryResponse>(DEFAULT_RESULTS);
  const [facets, setFacets] = useState<ErrorExplorerFacetsResponse>(DEFAULT_FACETS);
  const [details, setDetails] = useState<ErrorExplorerDetailsResponse | null>(null);
  const [selectedMeasurementID, setSelectedMeasurementID] = useState<number | null>(null);
  const [loadingRows, setLoadingRows] = useState(false);
  const [loadingFacets, setLoadingFacets] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [rowModesModel, setRowModesModel] = useState<GridRowModesModel>({});
  const [selectableOpts, setSelectableOpts] = useState<{ codes: string[] }>({ codes: [] });
  const [undoToastOperationID, setUndoToastOperationID] = useState<number | null>(null);

  const editFlow = useEditPreviewFlow({
    schema: currentSite?.schemaName ?? '',
    plotID: currentPlot?.plotID ?? 0,
    censusID: activeCensusID ?? 0,
    dataType: 'measurementssummary',
    onError: error => {
      setErrorMessage(error.message);
    }
  });

  useEffect(() => {
    if (!storageKey) return;
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      setFilters({
        ...DEFAULT_ERROR_EXPLORER_FILTERS,
        ...parsed,
        exactMessages: parsed?.exactMessages ?? [],
        affectedFields: parsed?.affectedFields ?? [],
        contradictionTypes: parsed?.contradictionTypes ?? []
      });
    } catch {
      // Ignore invalid saved state and use defaults.
    }
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    window.localStorage.setItem(storageKey, JSON.stringify(filters));
  }, [filters, storageKey]);

  const fetchRows = useCallback(
    async (scopeOverride?: ExplorerScope | null, signal?: AbortSignal) => {
      const scope = scopeOverride ?? resolveExplorerScope();
      if (!scope) return;
      setLoadingRows(true);
      setErrorMessage(null);
      try {
        const response = await fetch('/api/errors/explorer/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({
            schema: scope.schema,
            plotID: scope.plotID,
            censusID: scope.censusID,
            page: paginationModel.page,
            pageSize: paginationModel.pageSize,
            filters
          })
        });
        const data = (await response.json()) as ErrorExplorerQueryResponse | { error: string };
        if (!response.ok || 'error' in data) {
          throw new Error('error' in data ? data.error : 'Failed to load errors');
        }
        setResults(data);
        if (selectedMeasurementID && !data.rows.some(row => row.coreMeasurementID === selectedMeasurementID)) {
          setDetails(current => (current?.row?.coreMeasurementID === selectedMeasurementID ? null : current));
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        const errorObj = error instanceof Error ? error : new Error(String(error));
        setErrorMessage(errorObj.message);
      } finally {
        if (!signal?.aborted) setLoadingRows(false);
      }
    },
    [filters, paginationModel.page, paginationModel.pageSize, resolveExplorerScope, selectedMeasurementID]
  );

  const fetchFacets = useCallback(
    async (scopeOverride?: ExplorerScope | null, signal?: AbortSignal) => {
      const scope = scopeOverride ?? resolveExplorerScope();
      if (!scope) return;
      setLoadingFacets(true);
      try {
        const response = await fetch('/api/errors/explorer/facets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({
            schema: scope.schema,
            plotID: scope.plotID,
            censusID: scope.censusID,
            filters
          })
        });
        const data = (await response.json()) as ErrorExplorerFacetsResponse | { error: string };
        if (!response.ok || 'error' in data) {
          throw new Error('error' in data ? data.error : 'Failed to load filters');
        }
        setFacets(data);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        const errorObj = error instanceof Error ? error : new Error(String(error));
        setErrorMessage(errorObj.message);
      } finally {
        if (!signal?.aborted) setLoadingFacets(false);
      }
    },
    [filters, resolveExplorerScope]
  );

  const fetchDetails = useCallback(
    async (measurementID: number, scopeOverride?: ExplorerScope | null, signal?: AbortSignal) => {
      const scope = scopeOverride ?? resolveExplorerScope();
      if (!scope) return;
      setLoadingDetails(true);
      try {
        const searchParams = new URLSearchParams({
          schema: scope.schema,
          plotID: String(scope.plotID),
          censusID: String(scope.censusID)
        });
        if (filters.contradictionTypes.length === 1) {
          searchParams.set('activeContradictionType', filters.contradictionTypes[0]);
        }
        const response = await fetch(`/api/errors/explorer/details/${measurementID}?${searchParams.toString()}`, { signal });
        const data = (await response.json()) as ErrorExplorerDetailsResponse | { error: string };
        if (!response.ok || 'error' in data) {
          throw new Error('error' in data ? data.error : 'Failed to load row details');
        }
        setDetails(data);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        const errorObj = error instanceof Error ? error : new Error(String(error));
        setErrorMessage(errorObj.message);
      } finally {
        if (!signal?.aborted) setLoadingDetails(false);
      }
    },
    [filters.contradictionTypes, resolveExplorerScope]
  );

  const refreshMeasurementsSummaryScope = useCallback(
    async (scopeOverride?: ExplorerScope | null) => {
      const scope = scopeOverride ?? resolveExplorerScope();
      if (!scope) {
        throw new Error('Explorer scope is not available');
      }

      const response = await fetch(`/api/refreshviews/measurementssummary/${scope.schema}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plotID: scope.plotID,
          censusID: scope.censusID
        })
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error || body?.message || 'Failed to refresh errors explorer data');
      }
    },
    [resolveExplorerScope]
  );

  const refreshViewFullTableScope = useCallback(
    async (scopeOverride?: ExplorerScope | null) => {
      const scope = scopeOverride ?? resolveExplorerScope();
      if (!scope) {
        throw new Error('Explorer scope is not available');
      }

      const response = await fetch(`/api/refreshviews/viewfulltable/${scope.schema}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plotID: scope.plotID,
          censusID: scope.censusID
        })
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error || body?.message || 'Failed to refresh view full table data');
      }
    },
    [resolveExplorerScope]
  );

  const syncEditedRowLocally = useCallback((updatedRow: ErrorExplorerRow) => {
    setResults(current => ({
      ...current,
      rows: current.rows.map(row => (row.coreMeasurementID === updatedRow.coreMeasurementID ? mergeEditedRow(row, updatedRow) : row))
    }));
    setDetails(current => {
      if (!current?.row || current.row.coreMeasurementID !== updatedRow.coreMeasurementID) {
        return current;
      }

      return {
        ...current,
        row: mergeEditedRow(current.row, updatedRow)
      };
    });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchRows(undefined, controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [fetchRows]);

  useEffect(() => {
    const controller = new AbortController();
    fetchFacets(undefined, controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [fetchFacets]);

  useEffect(() => {
    if (!selectedMeasurementID) {
      setDetails(null);
      return;
    }
    const controller = new AbortController();
    fetchDetails(selectedMeasurementID, undefined, controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [fetchDetails, selectedMeasurementID]);

  useEffect(() => {
    if (!currentSite?.schemaName) return;
    const controller = new AbortController();
    loadSelectableOptions(currentSite, currentPlot, currentCensus, setSelectableOpts, controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [currentSite, currentPlot, currentCensus]);

  const updateFilters = useCallback((updater: (prev: ErrorExplorerFilters) => ErrorExplorerFilters) => {
    setFilters(prev => updater(prev));
    setPaginationModel(prev => ({ ...prev, page: 0 }));
  }, []);

  const handlePresetClick = useCallback((presetID: string) => {
    const preset = ERROR_EXPLORER_PRESETS.find(item => item.id === presetID);
    if (!preset) return;
    setFilters({
      ...preset.filters,
      presetId: preset.id
    });
    setPaginationModel(prev => ({ ...prev, page: 0 }));
  }, []);

  const processRowUpdate = useCallback(
    async (newRow: GridRowModel, oldRow: GridRowModel) => {
      if (!currentSite?.schemaName) {
        throw new Error('Site context not available');
      }

      const coreMeasurementID = Number((newRow as ErrorExplorerRow).coreMeasurementID ?? (oldRow as ErrorExplorerRow).coreMeasurementID);
      if (!Number.isFinite(coreMeasurementID) || coreMeasurementID <= 0) {
        throw new Error('Missing CoreMeasurementID for edit');
      }

      // Failed rows (cm.StemGUID IS NULL) live in the failedmeasurements edit
      // surface — its canonical fields and writer differ from measurementssummary.
      // Branch per-row so editing a hard-failed row doesn't 404 in loadCurrentRow.
      const isFailedRow = Boolean((oldRow as ErrorExplorerRow).isFailedRow);
      const surface = isFailedRow ? 'failedmeasurements' : 'measurementssummary';

      const { diff: editableDiff, roundedNoOpFields } = buildEditableFieldsDiffWithMetaForSurface(newRow, oldRow, surface);
      if (Object.keys(editableDiff).length === 0) {
        if (roundedNoOpFields.length > 0) {
          setErrorMessage(`No change saved: ${roundedNoOpFields.join(', ')} rounded to the existing value (server stores at fixed precision).`);
        }
        return newRow;
      }

      const applyResult = await editFlow.beginEdit(coreMeasurementID, editableDiff, { dataType: surface });

      const updatedRow = { ...(newRow as ErrorExplorerRow) };
      if (updatedRow.attributes !== (oldRow as ErrorExplorerRow).attributes) {
        updatedRow.rawCodes = updatedRow.attributes;
      }
      const rowScope = resolveExplorerScope(updatedRow) ?? resolveExplorerScope(oldRow as ErrorExplorerRow);
      syncEditedRowLocally(updatedRow);

      if (applyResult.editOperationID !== null) {
        setUndoToastOperationID(applyResult.editOperationID);
      }

      try {
        await Promise.all([refreshMeasurementsSummaryScope(rowScope), refreshViewFullTableScope(rowScope)]);
      } catch (error) {
        const errorObj = error instanceof Error ? error : new Error(String(error));
        setErrorMessage(`Row updated, but the explorer could not refresh: ${errorObj.message}`);
        return updatedRow;
      }

      await Promise.all([
        fetchRows(rowScope),
        fetchFacets(rowScope),
        selectedMeasurementID ? fetchDetails(selectedMeasurementID, rowScope) : Promise.resolve()
      ]);
      return updatedRow;
    },
    [
      currentSite?.schemaName,
      editFlow,
      fetchDetails,
      fetchFacets,
      fetchRows,
      refreshMeasurementsSummaryScope,
      refreshViewFullTableScope,
      resolveExplorerScope,
      selectedMeasurementID,
      syncEditedRowLocally
    ]
  );

  const handleProcessRowUpdateError = useCallback((error: Error) => {
    if (isMuiRowEditCancelled(error)) return;
    setErrorMessage(error.message);
  }, []);

  const handleRowEditStop: GridEventListener<'rowEditStop'> = (params, event) => {
    if (params.reason === GridRowEditStopReasons.rowFocusOut) {
      event.defaultMuiPrevented = true;
    }
  };

  const columns = useMemo<GridColDef[]>(
    () => [
      ...(canEditRows
        ? [
            {
              field: 'actions',
              type: 'actions',
              headerName: 'Actions',
              width: 74,
              getActions: ({ id }: { id: string | number }) => {
                const isInEditMode = rowModesModel[id]?.mode === GridRowModes.Edit;
                if (isInEditMode) {
                  return [
                    <GridActionsCellItem
                      key="save"
                      icon={<SaveIcon />}
                      label="Save"
                      onClick={() => setRowModesModel(prev => ({ ...prev, [id]: { mode: GridRowModes.View } }))}
                    />,
                    <GridActionsCellItem
                      key="cancel"
                      icon={<CancelIcon />}
                      label="Cancel"
                      onClick={() => setRowModesModel(prev => ({ ...prev, [id]: { mode: GridRowModes.View, ignoreModifications: true } }))}
                    />
                  ];
                }
                return [
                  <GridActionsCellItem
                    key="edit"
                    icon={<EditIcon />}
                    label="Edit"
                    onClick={() => setRowModesModel(prev => ({ ...prev, [id]: { mode: GridRowModes.Edit } }))}
                  />
                ];
              }
            } satisfies GridColDef
          ]
        : []),
      {
        field: 'hasContradiction',
        headerName: 'Conflict',
        minWidth: 150,
        width: 150,
        sortable: false,
        headerAlign: 'left',
        align: 'left',
        renderCell: params => {
          const contradictionTypes = getDisplayedContradictionTypes(params.row as ErrorExplorerRow);

          if (contradictionTypes.length === 0) {
            return (
              <Chip size="sm" variant="soft">
                None
              </Chip>
            );
          }

          return (
            <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', py: 0.5 }}>
              {contradictionTypes.map(type => (
                <Chip key={type} size="sm" color="warning" startDecorator={<CallSplitIcon />}>
                  {CONTRADICTION_LABELS[type]}
                </Chip>
              ))}
            </Stack>
          );
        }
      },
      {
        field: 'primaryErrorMessage',
        headerName: 'Primary Error',
        minWidth: 260,
        flex: 1.5,
        editable: false,
        headerAlign: 'left',
        align: 'left',
        renderCell: params => renderPreviewCell(params.value as string | undefined, 2)
      },
      {
        field: 'errorCount',
        headerName: 'Errors',
        width: 80,
        editable: false,
        type: 'number',
        align: 'center',
        headerAlign: 'center'
      },
      {
        field: 'treeTag',
        headerName: 'Tree Tag',
        minWidth: 110,
        flex: 0.7,
        editable: true,
        headerAlign: 'left',
        align: 'left'
      },
      {
        field: 'stemTag',
        headerName: 'Stem Tag',
        minWidth: 110,
        flex: 0.7,
        editable: true,
        headerAlign: 'left',
        align: 'left'
      },
      {
        field: 'speciesCode',
        headerName: 'Species',
        minWidth: 110,
        flex: 0.7,
        editable: canEditSpeciesCode,
        headerAlign: 'left',
        align: 'left'
      },
      {
        field: 'quadratName',
        headerName: 'Quadrat',
        minWidth: 110,
        flex: 0.7,
        editable: true,
        headerAlign: 'left',
        align: 'left'
      },
      {
        field: 'measurementDate',
        headerName: 'Date',
        minWidth: 120,
        flex: 0.8,
        editable: true,
        headerAlign: 'left',
        align: 'left'
      },
      {
        field: 'stemLocalX',
        headerName: 'X',
        width: 90,
        type: 'number',
        editable: true,
        align: 'right',
        headerAlign: 'right',
        valueFormatter: (value: number | null | undefined) => Number(value ?? 0).toFixed(2)
      },
      {
        field: 'stemLocalY',
        headerName: 'Y',
        width: 90,
        type: 'number',
        editable: true,
        align: 'right',
        headerAlign: 'right',
        valueFormatter: (value: number | null | undefined) => Number(value ?? 0).toFixed(2)
      },
      {
        field: 'measuredDBH',
        headerName: 'DBH',
        width: 95,
        type: 'number',
        editable: true,
        align: 'right',
        headerAlign: 'right',
        valueFormatter: (value: number | null | undefined) => Number(value ?? 0).toFixed(2)
      },
      {
        field: 'measuredHOM',
        headerName: 'HOM',
        width: 95,
        type: 'number',
        editable: true,
        align: 'right',
        headerAlign: 'right',
        valueFormatter: (value: number | null | undefined) => Number(value ?? 0).toFixed(2)
      },
      {
        field: 'description',
        headerName: 'Description',
        minWidth: 220,
        flex: 1.1,
        editable: true,
        headerAlign: 'left',
        align: 'left',
        renderCell: params => renderPreviewCell(params.value as string | undefined, 2)
      },
      {
        field: 'attributes',
        headerName: 'Codes',
        minWidth: 180,
        flex: 0.9,
        editable: true,
        headerAlign: 'left',
        align: 'left',
        renderCell: params => {
          const row = params.row as ErrorExplorerRow;
          const displayedCodes = getUploadedCodesValue(row);
          const mismatchMessage = getCodesMismatchMessage(row);

          return (
            <Stack spacing={0.25} sx={{ py: 0.5 }}>
              {renderCodesChips(displayedCodes)}
              {mismatchMessage ? (
                <Typography level="body-xs" color="warning" sx={{ whiteSpace: 'normal', lineHeight: 1.2 }}>
                  {mismatchMessage}
                </Typography>
              ) : null}
            </Stack>
          );
        },
        renderEditCell: params => (
          <Autocomplete
            sx={{ display: 'flex', flex: 1, width: '100%', height: '100%' }}
            multiple
            freeSolo
            autoHighlight
            clearOnBlur={false}
            options={[...selectableOpts.codes].sort((a, b) => a.localeCompare(b))}
            value={parseCodesString(getCodesEditValue(params.row as ErrorExplorerRow, params.value as string | undefined))}
            isOptionEqualToValue={(o, v) => o === v}
            onChange={(_event, next) => {
              params.api.setEditCellValue({
                id: params.id,
                field: params.field,
                value: joinCodesArray(next)
              });
            }}
          />
        )
      }
    ],
    [canEditRows, canEditSpeciesCode, rowModesModel, selectableOpts]
  );

  return (
    <Stack spacing={2} sx={{ width: '100%' }}>
      <Stack spacing={1}>
        <Typography level="h2">Errors Explorer</Typography>
        <Typography level="body-sm">
          Review unresolved validation and ingestion errors, filter by exact message, and inspect contradiction-linked rows within the active census.
        </Typography>
      </Stack>

      {!canEditRows && (
        <Alert color="neutral" data-testid="errorsexplorer-readonly-banner">
          Read-only view — your role can&apos;t edit these rows.
        </Alert>
      )}

      {errorMessage && (
        <Alert color="danger" startDecorator={<ReportProblemOutlinedIcon />}>
          {errorMessage}
        </Alert>
      )}

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
        <Card variant="soft" sx={{ minWidth: 140 }}>
          <Typography level="body-xs">Matching rows</Typography>
          <Typography level="h3">{results.summary.total}</Typography>
        </Card>
        <Card variant="soft" color="primary" sx={{ minWidth: 140 }}>
          <Typography level="body-xs">Validation</Typography>
          <Typography level="h3">{results.summary.validation}</Typography>
        </Card>
        <Card variant="soft" color="warning" sx={{ minWidth: 140 }}>
          <Typography level="body-xs">Ingestion</Typography>
          <Typography level="h3">{results.summary.ingestion}</Typography>
        </Card>
        <Card variant="soft" color="danger" sx={{ minWidth: 160 }}>
          <Typography level="body-xs">Contradictions</Typography>
          <Typography level="h3">{results.summary.contradictions}</Typography>
        </Card>
      </Stack>

      <Sheet variant="outlined" sx={{ p: 2, borderRadius: 'md' }}>
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ flexWrap: 'wrap' }}>
            {ERROR_EXPLORER_PRESETS.map(preset => (
              <Chip
                key={preset.id}
                variant={filters.presetId === preset.id ? 'solid' : 'soft'}
                color={filters.presetId === preset.id ? 'primary' : 'neutral'}
                role="button"
                tabIndex={0}
                onClick={() => handlePresetClick(preset.id)}
                onKeyDown={(e: React.KeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handlePresetClick(preset.id);
                  }
                }}
                sx={{ cursor: 'pointer' }}
              >
                {preset.label}
              </Chip>
            ))}
          </Stack>

          <Stack direction={{ xs: 'column', xl: 'row' }} spacing={1.5}>
            <FormControl sx={{ minWidth: 180 }}>
              <FormLabel htmlFor="errors-explorer-source">Source</FormLabel>
              <Select
                id="errors-explorer-source"
                value={filters.source}
                onChange={(_event, value) =>
                  updateFilters(prev => ({
                    ...prev,
                    source: value ?? 'all',
                    presetId: undefined
                  }))
                }
              >
                <Option value="all">Both sources</Option>
                <Option value="validation">Validation only</Option>
                <Option value="ingestion">Ingestion only</Option>
              </Select>
            </FormControl>

            <FormControl sx={{ minWidth: 280, flex: 1 }}>
              <FormLabel htmlFor="errors-explorer-exact-message">Exact Error Message</FormLabel>
              <Autocomplete
                id="errors-explorer-exact-message"
                multiple
                loading={loadingFacets}
                options={facets.messages.map(option => `${option.value} (${option.count})`)}
                value={filters.exactMessages.map(message => {
                  const option = facets.messages.find(item => item.value === message);
                  return option ? `${option.value} (${option.count})` : message;
                })}
                onChange={(_event, value) =>
                  updateFilters(prev => ({
                    ...prev,
                    exactMessages: value.map(item => item.replace(/\s\(\d+\)$/, '')),
                    presetId: undefined
                  }))
                }
                placeholder="Filter rows by exact displayed message"
              />
            </FormControl>

            <FormControl sx={{ minWidth: 220, flex: 0.8 }}>
              <FormLabel htmlFor="errors-explorer-affected-field">Affected Field</FormLabel>
              <Autocomplete
                id="errors-explorer-affected-field"
                multiple
                loading={loadingFacets}
                options={facets.fields.map(option => `${option.value} (${option.count})`)}
                value={filters.affectedFields.map(field => {
                  const option = facets.fields.find(item => item.value === field);
                  return option ? `${option.value} (${option.count})` : field;
                })}
                onChange={(_event, value) =>
                  updateFilters(prev => ({
                    ...prev,
                    affectedFields: value.map(item => item.replace(/\s\(\d+\)$/, '')),
                    presetId: undefined
                  }))
                }
                placeholder="Optional"
              />
            </FormControl>

            <FormControl sx={{ minWidth: 220, flex: 1 }}>
              <FormLabel htmlFor="errors-explorer-quick-search">Quick Search</FormLabel>
              <Input
                id="errors-explorer-quick-search"
                aria-label="Quick Search"
                value={filters.quickSearch}
                onChange={event =>
                  updateFilters(prev => ({
                    ...prev,
                    quickSearch: event.target.value,
                    presetId: undefined
                  }))
                }
                placeholder="Search tags, species, quadrat, messages"
              />
            </FormControl>
          </Stack>

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'flex-start', md: 'center' }}>
            <FormControl orientation="horizontal" sx={{ gap: 1 }}>
              <FormLabel htmlFor="errors-explorer-contradictions-only">Contradictions only</FormLabel>
              <Switch
                id="errors-explorer-contradictions-only"
                aria-label="Contradictions only"
                checked={filters.contradictionOnly}
                onChange={event =>
                  updateFilters(prev => ({
                    ...prev,
                    contradictionOnly: event.target.checked,
                    presetId: undefined
                  }))
                }
              />
            </FormControl>

            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
              <Chip
                variant={filters.contradictionTypes.includes('duplicate_tag_stem') ? 'solid' : 'soft'}
                color="warning"
                role="button"
                tabIndex={0}
                onClick={() =>
                  updateFilters(prev => ({
                    ...prev,
                    contradictionTypes: prev.contradictionTypes.includes('duplicate_tag_stem')
                      ? prev.contradictionTypes.filter(type => type !== 'duplicate_tag_stem')
                      : [...prev.contradictionTypes, 'duplicate_tag_stem'],
                    presetId: undefined
                  }))
                }
                onKeyDown={(e: React.KeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    updateFilters(prev => ({
                      ...prev,
                      contradictionTypes: prev.contradictionTypes.includes('duplicate_tag_stem')
                        ? prev.contradictionTypes.filter(type => type !== 'duplicate_tag_stem')
                        : [...prev.contradictionTypes, 'duplicate_tag_stem'],
                      presetId: undefined
                    }));
                  }
                }}
                sx={{ cursor: 'pointer' }}
              >
                Duplicate tag/stem ({facets.contradictionCounts.duplicateTagStem})
              </Chip>
              <Chip
                variant={filters.contradictionTypes.includes('same_batch_conflict') ? 'solid' : 'soft'}
                color="warning"
                role="button"
                tabIndex={0}
                onClick={() =>
                  updateFilters(prev => ({
                    ...prev,
                    contradictionTypes: prev.contradictionTypes.includes('same_batch_conflict')
                      ? prev.contradictionTypes.filter(type => type !== 'same_batch_conflict')
                      : [...prev.contradictionTypes, 'same_batch_conflict'],
                    presetId: undefined
                  }))
                }
                onKeyDown={(e: React.KeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    updateFilters(prev => ({
                      ...prev,
                      contradictionTypes: prev.contradictionTypes.includes('same_batch_conflict')
                        ? prev.contradictionTypes.filter(type => type !== 'same_batch_conflict')
                        : [...prev.contradictionTypes, 'same_batch_conflict'],
                      presetId: undefined
                    }));
                  }
                }}
                sx={{ cursor: 'pointer' }}
              >
                Same-batch conflicts ({facets.contradictionCounts.sameBatchConflict})
              </Chip>
            </Stack>
          </Stack>
        </Stack>
      </Sheet>

      <Sheet
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 430px' },
          alignItems: 'start'
        }}
      >
        <Sheet variant="outlined" sx={{ flex: 1, minWidth: 0, borderRadius: 'md', p: 1 }}>
          <StyledDataGrid
            autoHeight={false}
            rows={results.rows as any[]}
            columns={columns}
            loading={loadingRows}
            rowCount={results.totalRows}
            paginationMode="server"
            paginationModel={paginationModel}
            onPaginationModelChange={setPaginationModel}
            pageSizeOptions={[25, 50, 100]}
            editMode="row"
            rowModesModel={rowModesModel}
            onRowModesModelChange={setRowModesModel}
            processRowUpdate={processRowUpdate}
            onProcessRowUpdateError={handleProcessRowUpdateError}
            onRowEditStop={handleRowEditStop}
            onRowClick={params => setSelectedMeasurementID(Number(params.row.coreMeasurementID))}
            rowHeight={68}
            sx={{
              minHeight: 640,
              '& .MuiDataGrid-cell': {
                alignItems: 'center',
                py: 0.75,
                whiteSpace: 'nowrap',
                overflow: 'hidden'
              },
              '& .MuiDataGrid-columnHeaderTitle': {
                fontWeight: 700
              },
              '& .MuiDataGrid-row.Mui-selected': {
                outline: '1px solid',
                outlineColor: 'var(--joy-palette-primary-outlinedBorder)',
                backgroundColor: 'rgba(59, 130, 246, 0.08)'
              }
            }}
          />
        </Sheet>

        <Sheet
          variant="soft"
          sx={{
            width: '100%',
            minHeight: 320,
            borderRadius: 'md',
            p: 2,
            position: { lg: 'sticky' },
            top: { lg: 16 },
            maxHeight: { lg: 'calc(100vh - 120px)' },
            overflow: 'auto'
          }}
        >
          <Stack spacing={1.5}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography level="title-lg">Row Details</Typography>
              {selectedMeasurementID && (
                <Button size="sm" variant="plain" onClick={() => setSelectedMeasurementID(null)}>
                  Close
                </Button>
              )}
            </Stack>

            {!selectedMeasurementID && <Typography level="body-sm">Select a row to inspect its errors and contradiction links.</Typography>}

            {selectedMeasurementID && loadingDetails && (
              <Stack direction="row" spacing={1} alignItems="center">
                <CircularProgress size="sm" />
                <Typography level="body-sm">Loading row details…</Typography>
              </Stack>
            )}

            {selectedMeasurementID && !loadingDetails && !details?.row && (
              <Typography level="body-sm">This row is no longer in the current filtered result set.</Typography>
            )}

            {selectedMeasurementID && !loadingDetails && details?.row && (
              <>
                <Card size="sm" variant="soft" color={details.row.hasContradiction ? 'warning' : 'neutral'}>
                  <Stack spacing={1}>
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                      <Stack spacing={0.25} sx={{ minWidth: 0 }}>
                        <Typography level="title-md">{details.row.primaryErrorMessage}</Typography>
                        <Typography level="body-sm">
                          Row {details.row.coreMeasurementID}
                          {details.row.treeTag ? ` | Tree ${details.row.treeTag}` : ''}
                          {details.row.stemTag ? ` | Stem ${details.row.stemTag}` : ''}
                        </Typography>
                      </Stack>
                      <Chip size="sm" color={details.row.hasContradiction ? 'warning' : 'primary'} variant="solid">
                        {details.row.errorCount} error{details.row.errorCount === 1 ? '' : 's'}
                      </Chip>
                    </Stack>

                    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                      {details.row.speciesCode && (
                        <Chip size="sm" variant="soft">
                          {details.row.speciesCode}
                        </Chip>
                      )}
                      {details.row.quadratName && (
                        <Chip size="sm" variant="soft">
                          {details.row.quadratName}
                        </Chip>
                      )}
                      {details.row.measurementDate && (
                        <Chip size="sm" variant="soft">
                          {details.row.measurementDate}
                        </Chip>
                      )}
                      {getDisplayedContradictionTypes(details.row).map(type => (
                        <Chip key={type} size="sm" color="warning" startDecorator={<CallSplitIcon />}>
                          {CONTRADICTION_LABELS[type]}
                        </Chip>
                      ))}
                    </Stack>

                    <Typography level="body-sm">{details.row.description || 'No row description.'}</Typography>
                  </Stack>
                </Card>

                <Stack spacing={0.75}>
                  <Typography level="title-sm">Why this row is surfaced</Typography>
                  <Typography level="body-sm">
                    {details.row.errorMessages.length} matching displayed message{details.row.errorMessages.length === 1 ? '' : 's'} across{' '}
                    {details.row.errorSources.join(' + ')} sources.
                  </Typography>
                  <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                    {details.allErrors.map((error, index) => (
                      <Chip key={`${error.code}-${index}`} size="sm" color={error.source === 'validation' ? 'primary' : 'warning'}>
                        {error.source}:{error.code}
                      </Chip>
                    ))}
                  </Stack>
                </Stack>

                {(getUploadedCodesValue(details.row) || getMaterializedCodesValue(details.row)) && (
                  <Stack spacing={0.75}>
                    <Typography level="title-sm">Codes</Typography>
                    <Card size="sm" variant={hasCodesMismatch(details.row) ? 'soft' : 'outlined'} color={hasCodesMismatch(details.row) ? 'warning' : 'neutral'}>
                      <Stack spacing={1}>
                        <Stack spacing={0.25}>
                          <Typography level="body-xs" textTransform="uppercase">
                            Uploaded
                          </Typography>
                          {renderCodesChips(getUploadedCodesValue(details.row))}
                        </Stack>

                        {hasCodesMismatch(details.row) && (
                          <>
                            <Stack spacing={0.25}>
                              <Typography level="body-xs" textTransform="uppercase">
                                Materialized
                              </Typography>
                              {renderCodesChips(getMaterializedCodesValue(details.row), 'None')}
                            </Stack>
                            <Typography level="body-xs" color="warning">
                              {getCodesMismatchMessage(details.row)}
                            </Typography>
                          </>
                        )}
                      </Stack>
                    </Card>
                  </Stack>
                )}

                {details.row.hasContradiction && details.relatedRows.length > 0 && (
                  <>
                    <Divider />
                    <ContradictionComparisonPanel
                      selectedRow={details.row}
                      relatedRows={details.relatedRows}
                      onInspectRow={measurementID => setSelectedMeasurementID(measurementID)}
                    />
                  </>
                )}

                {details.row.hasContradiction && details.relatedRows.length === 0 && (
                  <Typography level="body-sm">This row is marked as contradictory, but no linked rows are currently available to compare.</Typography>
                )}

                <Divider />

                <Stack spacing={1}>
                  <Typography level="title-sm">All Errors</Typography>
                  {details.allErrors.map((error, index) => (
                    <Card key={`${error.code}-${index}`} size="sm" variant="outlined">
                      <Stack spacing={0.5}>
                        <Typography level="body-sm" fontWeight="lg">
                          {error.message}
                        </Typography>
                        <Typography level="body-xs">
                          {error.source} / {error.code}
                        </Typography>
                        {error.fields.length > 0 && (
                          <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                            {error.fields.map(field => (
                              <Chip key={`${error.code}-${field}`} size="sm" variant="soft">
                                {field}
                              </Chip>
                            ))}
                          </Stack>
                        )}
                        {error.procedureName && <Typography level="body-xs">Procedure: {error.procedureName}</Typography>}
                      </Stack>
                    </Card>
                  ))}
                </Stack>
              </>
            )}
          </Stack>
        </Sheet>
      </Sheet>
      {editFlow.dialogState.open && editFlow.dialogState.plan && (
        <PreviewDialog
          plan={editFlow.dialogState.plan}
          busy={editFlow.dialogState.busy}
          wasRefreshed={editFlow.dialogState.wasRefreshed}
          onConfirm={editFlow.confirmDialog}
          onCancel={editFlow.cancelDialog}
        />
      )}
      {undoToastOperationID !== null && (
        <UndoToast
          editOperationID={undoToastOperationID}
          onUndo={async () => {
            const scope = resolveExplorerScope();
            if (!scope) {
              setErrorMessage('Explorer scope is not available');
              return;
            }
            try {
              const response = await fetch(`/api/edits/revert`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  schema: scope.schema,
                  plotID: scope.plotID,
                  censusID: scope.censusID,
                  editOperationID: undoToastOperationID
                })
              });
              if (!response.ok) throw new Error(`revert failed (${response.status})`);
              await Promise.all([refreshMeasurementsSummaryScope(scope), refreshViewFullTableScope(scope)]);
              await fetchRows(scope);
            } catch (error: unknown) {
              const message = error instanceof Error ? error.message : String(error);
              setErrorMessage(`Undo failed: ${message}`);
            }
          }}
          onDismiss={() => setUndoToastOperationID(null)}
        />
      )}
    </Stack>
  );
}
