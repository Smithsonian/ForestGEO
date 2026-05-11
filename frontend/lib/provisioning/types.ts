import type { Pool } from 'mysql2/promise';

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

export type QuadratConfig = QuadratGridConfig | QuadratCsvConfig;

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
    defaultDimensionUnits: string;
    defaultCoordinateUnits: string;
    defaultAreaUnits: string;
    defaultDBHUnits: string;
    defaultHOMUnits: string;
  };
  quadrats: QuadratConfig;
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

export class ProvisioningError extends Error {
  constructor(
    message: string,
    public readonly stepKey: StepKey,
    public readonly meta: { file?: string; lineNumber?: number; sqlState?: string; errno?: number } = {}
  ) {
    super(message);
    this.name = 'ProvisioningError';
  }
}
