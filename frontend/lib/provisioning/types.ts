import type { Pool } from 'mysql2/promise';
import type { AreaUnit, DimensionUnit } from './area';

export type RunStatus = 'running' | 'completed' | 'failed' | 'aborted';
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export type StepKey =
  | 'validate_inputs'
  | 'create_schema'
  | 'init_tables'
  | 'deploy_procedures'
  | 'seed_validations'
  | 'apply_migrations'
  | 'insert_catalog_row'
  | 'insert_plot'
  | 'insert_census'
  | 'insert_quadrats'
  | 'verify';

export interface QuadratGridConfig {
  mode: 'grid';
  quadratSizeX: number;
  quadratSizeY: number;
  namingPattern: 'sequential' | 'row-col';
}

export interface QuadratCsvRow {
  quadratName: string;
  startX: number;
  startY: number;
  dimensionX: number;
  dimensionY: number;
}

export interface QuadratCsvConfig {
  mode: 'csv';
  rows: QuadratCsvRow[];
}

/**
 * Create the site with no quadrats. Use when the real quadrat list will be uploaded
 * later through the Quadrats page, so provisioning does not seed a placeholder grid
 * that would otherwise coexist with (and duplicate) the uploaded quadrats.
 */
export interface QuadratNoneConfig {
  mode: 'none';
}

export type QuadratConfig = QuadratGridConfig | QuadratCsvConfig | QuadratNoneConfig;

/**
 * Which corner of its own quadrat a CSV row's StartX/StartY identifies.
 * Compass values are relative to the plot's local axes: east is higher X,
 * north is higher Y. This does not move the plot's coordinate origin.
 */
export type QuadratReferenceCorner = 'SW' | 'SE' | 'NW' | 'NE';

/** Wire/client shape: rows are in the uploaded convention. */
export interface QuadratCsvRequestConfig {
  mode: 'csv';
  rows: QuadratCsvRow[];
  coordinateReferenceCorner: QuadratReferenceCorner;
}

/** Server/run shape: rows are canonical south-west. */
export interface QuadratCsvCanonicalConfig {
  mode: 'csv';
  rows: QuadratCsvRow[];
  coordinates: 'canonical-sw';
  sourceCoordinateReferenceCorner: QuadratReferenceCorner;
}

export type QuadratRequestConfig = QuadratGridConfig | QuadratCsvRequestConfig | QuadratNoneConfig;
export type CanonicalQuadratConfig = QuadratGridConfig | QuadratCsvCanonicalConfig | QuadratNoneConfig;

export interface ProvisioningInput {
  site: {
    siteName: string;
    schemaName: string;
    sqDimX: number;
    sqDimY: number;
    defaultUOMDBH: string;
    defaultUOMHOM: string;
    doubleDataEntry: boolean;
    location: string;
    country: string;
  };
  plot: {
    plotName: string;
    dimensionX: number;
    dimensionY: number;
    area: number;
    globalX: number;
    globalY: number;
    globalZ: number;
    plotShape: 'square' | 'rectangular' | 'irregular';
    description: string;
    defaultDimensionUnits: DimensionUnit;
    defaultCoordinateUnits: DimensionUnit;
    defaultAreaUnits: AreaUnit;
    defaultDBHUnits: DimensionUnit;
    defaultHOMUnits: DimensionUnit;
  };
  quadrats: QuadratConfig;
}

export interface ProvisioningRunListRow {
  RunID: number;
  Status: RunStatus;
  StartedBy: string;
  StartedAt: string;
  FinishedAt: string | null;
  SiteName: string;
  SchemaName: string;
}

export interface ProvisioningRunRecord {
  runId: number;
  status: RunStatus;
  startedBy: string;
  startedAt: Date;
  finishedAt: Date | null;
  siteName: string;
  schemaName: string;
  input: ProvisioningInput;
}

export interface ProvisioningStepRecord {
  stepId: number;
  runId: number;
  stepIndex: number;
  stepKey: StepKey;
  status: StepStatus;
  startedAt: Date | null;
  finishedAt: Date | null;
  errorMessage: string | null;
  errorStack: string | null;
}

export interface StepContext {
  runId: number;
  schemaName: string;
  input: ProvisioningInput;
  catalogPool: Pool;
  /** Pool whose default schema is the new site schema. May be null before create_schema runs. */
  sitePool: Pool | null;
  /** Mutable across-step values (PlotID, SiteID, etc.) */
  state: Record<string, unknown>;
  logger: { info: (msg: string, meta?: object) => void; error: (msg: string, meta?: object) => void };
}

export interface ProvisioningStep {
  key: StepKey;
  label: string;
  alreadyDone(ctx: StepContext): Promise<boolean>;
  run(ctx: StepContext): Promise<void>;
}

export { ProvisioningError, type ProvisioningErrorKind } from './errors';
