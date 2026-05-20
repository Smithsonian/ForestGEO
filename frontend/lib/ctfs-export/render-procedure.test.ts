import { describe, it, expect } from 'vitest';
import { renderArtifact, type RenderArtifactInput } from './render-procedure';
import type { MeasurementStagingRow, AttributeStagingRow } from '../csv-to-sql-shared';

const baseInput = (overrides: Partial<RenderArtifactInput> = {}): RenderArtifactInput => ({
  schema: 'forestgeo_test',
  appPlotId: 5,
  destinationPlotId: 1,
  appCensusId: 7,
  plotCensusNumber: '2024',
  allowReload: false,
  reloadDryRun: false,
  generatedAt: new Date('2026-05-19T12:00:00Z'),
  measurementRows: [],
  attributeRows: [],
  ...overrides
});

const sampleMeasurement: MeasurementStagingRow = {
  CoreMeasurementID: 1,
  SourceRowIndex: 1,
  Tag: '1',
  StemTag: '1',
  Mnemonic: 'FOO',
  QuadratName: 'A1',
  PlotCensusNumber: '2024',
  Family: 'F',
  Genus: 'G',
  SpeciesName: 'foo',
  SpeciesAuthority: 'L.',
  SubspeciesName: null,
  SubspeciesAuthority: null,
  IDLevel: 'species',
  DBH: 10,
  HOM: '1.3',
  ExactDate: '2024-06-01',
  Comments: null,
  LX: 1,
  LY: 1,
  PrimaryStem: null
};

const sampleAttribute: AttributeStagingRow = {
  CoreMeasurementID: 1,
  TempMeasurementID: 1,
  TSMCode: 'AB'
};

/**
 * Strip header and normalize random suffix to allow deterministic comparison
 * across renders with different timestamps and random suffixes.
 */
const stripHeaderAndNormalizeSuffix = (s: string) =>
  s.replace(/^-- BEGIN HEADER\n[\s\S]*?-- END HEADER\n/, '').replace(/csv_to_sql_v2_load_(\d+)_([A-Za-z0-9_]+)_[0-9a-f]{8}/g, 'csv_to_sql_v2_load_$1_$2_RAND');

describe('renderArtifact', () => {
  it('returns procedureName matching the pattern csv_to_sql_v2_load_<plotId>_<slug>_<randomSuffix>', () => {
    const { procedureName } = renderArtifact(baseInput({ measurementRows: [sampleMeasurement] }));
    expect(procedureName).toMatch(/^csv_to_sql_v2_load_1_2024_[0-9a-f]{8}$/);
  });

  it('returns lockName in format ctfs-export:<plotId>:<census>', () => {
    const { lockName } = renderArtifact(baseInput({ measurementRows: [sampleMeasurement] }));
    expect(lockName).toBe('ctfs-export:1:2024');
  });

  it('sql starts with -- BEGIN HEADER', () => {
    const { sql } = renderArtifact(baseInput({ measurementRows: [sampleMeasurement] }));
    expect(sql).toMatch(/^-- BEGIN HEADER\n/);
  });

  it('header includes all metadata fields', () => {
    const { sql } = renderArtifact(
      baseInput({
        generatedAt: new Date('2026-05-19T12:00:00Z'),
        measurementRows: [sampleMeasurement],
        attributeRows: [sampleAttribute]
      })
    );
    expect(sql).toMatch(/-- Generated: 2026-05-19T12:00:00\.000Z/);
    expect(sql).toMatch(/-- Source schema: forestgeo_test/);
    expect(sql).toMatch(/-- Source app PlotID: 5/);
    expect(sql).toMatch(/-- Destination CTFS PlotID: 1/);
    expect(sql).toMatch(/-- App CensusID: 7/);
    expect(sql).toMatch(/-- PlotCensusNumber: 2024/);
    expect(sql).toMatch(/-- Measurement rows: 1/);
    expect(sql).toMatch(/-- Attribute rows: 1/);
    expect(sql).toMatch(/-- Options: allowReload=false reloadDryRun=false/);
  });

  it('header ends with -- END HEADER', () => {
    const { sql } = renderArtifact(baseInput({ measurementRows: [sampleMeasurement] }));
    expect(sql).toMatch(/-- END HEADER\n/);
  });

  it('body below END HEADER is deterministic across different timestamps when suffix is normalized', () => {
    const a = renderArtifact(
      baseInput({
        generatedAt: new Date('2026-05-19T00:00:00Z'),
        measurementRows: [sampleMeasurement]
      })
    );
    const b = renderArtifact(
      baseInput({
        generatedAt: new Date('2030-01-01T00:00:00Z'),
        measurementRows: [sampleMeasurement]
      })
    );
    expect(stripHeaderAndNormalizeSuffix(a.sql)).toBe(stripHeaderAndNormalizeSuffix(b.sql));
  });

  it('emits Stage 0b when allowReload is true', () => {
    const { sql } = renderArtifact(baseInput({ allowReload: true, measurementRows: [sampleMeasurement] }));
    expect(sql).toMatch(/Stage 0b: reload/);
    expect(sql).toMatch(/'DBHAttributes to delete'/);
    // Real-mode reload — no SAVEPOINT
    expect(sql).not.toMatch(/SAVEPOINT reload_dry/);
  });

  it('emits Stage 0b when reloadDryRun is true', () => {
    const { sql } = renderArtifact(baseInput({ allowReload: false, reloadDryRun: true }));
    expect(sql).toMatch(/Stage 0b: reload/);
  });

  it('reloadDryRun implies allowReload and wraps Stage 0b in SAVEPOINT', () => {
    const { sql } = renderArtifact(baseInput({ allowReload: false, reloadDryRun: true }));
    expect(sql).toMatch(/SAVEPOINT reload_dry/);
    expect(sql).toMatch(/ROLLBACK TO SAVEPOINT reload_dry/);
  });

  it('reloadDryRun does NOT emit Stages 1-10', () => {
    const { sql } = renderArtifact(baseInput({ reloadDryRun: true, measurementRows: [sampleMeasurement] }));
    expect(sql).not.toMatch(/staging_measurements/);
    expect(sql).not.toMatch(/CREATE TEMPORARY TABLE staging_measurements/);
    expect(sql).not.toMatch(/Stage 1:/);
    expect(sql).not.toMatch(/Stage 2:/);
    expect(sql).not.toMatch(/Stage 5:/);
    expect(sql).not.toMatch(/Stage 6:/);
    expect(sql).not.toMatch(/Stage 7:/);
    expect(sql).not.toMatch(/Stage 8:/);
    expect(sql).not.toMatch(/Stage 9:/);
    expect(sql).not.toMatch(/Stage 10:/);
  });

  it('non-reload, non-dry-run emits all Stages 1-10', () => {
    const { sql } = renderArtifact(baseInput({ measurementRows: [sampleMeasurement] }));
    expect(sql).toMatch(/Stage 1:/);
    expect(sql).toMatch(/Stage 2:/);
    expect(sql).toMatch(/Stage 5:/);
    expect(sql).toMatch(/Stage 6:/);
    expect(sql).toMatch(/Stage 7:/);
    expect(sql).toMatch(/Stage 8:/);
    expect(sql).toMatch(/Stage 9:/);
    expect(sql).toMatch(/Stage 10:/);
  });

  it('allowReload=true (non-dry-run) emits Stage 0b but not SAVEPOINT', () => {
    const { sql } = renderArtifact(baseInput({ allowReload: true, reloadDryRun: false, measurementRows: [sampleMeasurement] }));
    expect(sql).toMatch(/Stage 0b: reload/);
    expect(sql).not.toMatch(/SAVEPOINT reload_dry/);
    expect(sql).toMatch(/Stage 1:/);
  });

  it('allowReload=false, reloadDryRun=false emits Stage 0b guard (refuse populated) but NOT reload cleanup', () => {
    const { sql } = renderArtifact(
      baseInput({
        allowReload: false,
        reloadDryRun: false,
        measurementRows: [sampleMeasurement]
      })
    );
    // renderStage0 with allowReload=false includes "Stage 0b: refuse populated census" guard
    expect(sql).toMatch(/refuse populated census \(no --allow-reload\)/);
    // But NOT the reload cleanup (which has comment "Stage 0b: reload — capture orphan candidates")
    expect(sql).not.toMatch(/reload — capture orphan candidates/);
    expect(sql).toMatch(/Stage 1:/);
  });

  it('procedureName appears in DROP/CREATE/CALL statements', () => {
    const { procedureName, sql } = renderArtifact(baseInput({ measurementRows: [sampleMeasurement] }));
    expect(sql).toContain(`DROP PROCEDURE IF EXISTS ${procedureName};`);
    expect(sql).toContain(`CREATE PROCEDURE ${procedureName}()`);
    expect(sql).toContain(`CALL ${procedureName}();`);
  });

  it('lockName appears in GET_LOCK and RELEASE_LOCK calls', () => {
    const { sql } = renderArtifact(baseInput({ measurementRows: [sampleMeasurement] }));
    expect(sql).toMatch(/GET_LOCK\('ctfs-export:1:2024', 0\)/);
    expect(sql).toMatch(/RELEASE_LOCK\('ctfs-export:1:2024'\)/);
  });

  it('handles empty measurement and attribute rows', () => {
    const { sql } = renderArtifact(baseInput({ measurementRows: [], attributeRows: [] }));
    expect(sql).toMatch(/-- Measurement rows: 0/);
    expect(sql).toMatch(/-- Attribute rows: 0/);
    expect(sql).toMatch(/Stage 1:/);
  });

  it('handles multiple measurement and attribute rows', () => {
    const { sql } = renderArtifact(
      baseInput({
        measurementRows: [sampleMeasurement, sampleMeasurement],
        attributeRows: [sampleAttribute, sampleAttribute]
      })
    );
    expect(sql).toMatch(/-- Measurement rows: 2/);
    expect(sql).toMatch(/-- Attribute rows: 2/);
  });

  it('header reflects all input options correctly', () => {
    const { sql } = renderArtifact(
      baseInput({
        allowReload: true,
        reloadDryRun: false,
        measurementRows: [sampleMeasurement]
      })
    );
    expect(sql).toMatch(/-- Options: allowReload=true reloadDryRun=false/);
  });

  it('dry-run with allowReload=false still activates Stage 0b', () => {
    const { sql } = renderArtifact(baseInput({ allowReload: false, reloadDryRun: true }));
    expect(sql).toMatch(/Stage 0b: reload/);
    expect(sql).toMatch(/SAVEPOINT reload_dry/);
  });
});
