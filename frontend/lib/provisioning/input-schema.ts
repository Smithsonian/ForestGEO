import { z } from 'zod';
import { areaSelectionOptions, EPSG_CODE_MAX, EPSG_CODE_MIN, unitSelectionOptions } from '@/config/macros';
import { estimateGridQuadratCount, MAX_GENERATED_QUADRATS } from './grid-generator';
import { acknowledgmentCoversLayout, QUADRAT_OVERLAP_ACKNOWLEDGMENT_STATEMENT, validateQuadratCollectionDetailed } from './quadrat-collection-validation';
import type { ProvisioningInput } from './types';

const DimensionUnitSchema = z.enum(unitSelectionOptions);
const AreaUnitSchema = z.enum(areaSelectionOptions);

/**
 * plots.GlobalX/Y/Z are DECIMAL(15,6); this is that column's exact ceiling. Values are
 * linear coordinates in the plot's coordinate unit (projected meters such as UTM, not
 * degrees-minutes-seconds) — the 'All trees outside plot limits' post-validation query
 * (seeded by reinsertdefaultpostvalidations) adds LocalX/StartX directly onto GlobalX.
 * The bound exists so a too-large origin fails here with an explanation instead of as
 * a MySQL out-of-range error mid-provisioning (run 5, forestgeo_ldw, 2026-08-04).
 */
export const GLOBAL_COORDINATE_ABS_MAX = 999_999_999.999999;

export { EPSG_CODE_MIN, EPSG_CODE_MAX };

/**
 * The units/EPSG contract: DefaultCoordinateUnits describes the linear unit the
 * arithmetic above consumes, and the EPSG code records which system the numbers came
 * from. Provisioning input must be a LINEAR system, so the geographic (lat/lon degree)
 * codes an admin is likely to type are rejected here with a pointer to their projected
 * counterparts. This is a common-codes guard, not a registry: the app cannot classify
 * arbitrary EPSG codes as geographic vs projected. Legacy rows whose coordinates
 * already ARE degrees (e.g. forestgeo_niobrara) are deliberately still describable —
 * the plot-edit path does not apply this rejection, only new provisioning input does.
 */
export const GEOGRAPHIC_EPSG_CODES: ReadonlySet<number> = new Set([
  4326, // WGS 84
  4269, // NAD83
  4267 // NAD27
]);

function globalCoordinateSchema(axis: 'X' | 'Y' | 'Z') {
  const message =
    `Global ${axis} must be a plain linear coordinate in the plot's coordinate unit ` +
    `(e.g. UTM meters, like a UTM ${axis === 'Y' ? 'northing' : axis === 'X' ? 'easting' : 'elevation'}), ` +
    `with absolute value at most ${GLOBAL_COORDINATE_ABS_MAX}. Degrees-minutes-seconds is not supported.`;
  return z.number({ error: message }).finite(message).min(-GLOBAL_COORDINATE_ABS_MAX, message).max(GLOBAL_COORDINATE_ABS_MAX, message);
}

const EpsgCodeSchema = z
  .number()
  .int()
  .min(EPSG_CODE_MIN, `EPSG code must be between ${EPSG_CODE_MIN} and ${EPSG_CODE_MAX} (e.g. 26916 = NAD83 / UTM zone 16N).`)
  .max(EPSG_CODE_MAX, `EPSG code must be between ${EPSG_CODE_MIN} and ${EPSG_CODE_MAX} (e.g. 26916 = NAD83 / UTM zone 16N).`)
  .refine(code => !GEOGRAPHIC_EPSG_CODES.has(code), {
    message:
      'This EPSG code is a geographic (latitude/longitude degree) system, but the plot origin must be entered as linear coordinates. ' +
      'Enter the origin in a projected system and record that EPSG instead (e.g. 26916 = NAD83 / UTM zone 16N).'
  });

const LayoutSignatureSchema = z.string().regex(/^quadrat-layout-v1-[0-9a-f]{16}$/);
const QuadratOverlapAcknowledgmentSchema = z.object({
  statement: z.literal(QUADRAT_OVERLAP_ACKNOWLEDGMENT_STATEMENT),
  layoutSignatures: z.array(LayoutSignatureSchema).min(1).max(1000)
});

export const ProvisioningSiteSchema = z.object({
  siteName: z.string().min(1),
  schemaName: z.string().regex(/^forestgeo_[a-z0-9_]+$/),
  sqDimX: z.number().int().positive(),
  sqDimY: z.number().int().positive(),
  defaultUOMDBH: z.string().min(1),
  defaultUOMHOM: z.string().min(1),
  doubleDataEntry: z.boolean(),
  location: z.string().min(1),
  country: z.string().min(1)
});

export const ProvisioningPlotSchema = z.object({
  plotName: z.string().min(1),
  dimensionX: z.number().positive(),
  dimensionY: z.number().positive(),
  area: z.number().positive(),
  globalX: globalCoordinateSchema('X'),
  globalY: globalCoordinateSchema('Y'),
  globalZ: globalCoordinateSchema('Z'),
  globalCoordinatesEPSG: EpsgCodeSchema.optional(),
  plotShape: z.enum(['square', 'rectangular', 'irregular']),
  description: z.string(),
  defaultDimensionUnits: DimensionUnitSchema,
  defaultCoordinateUnits: DimensionUnitSchema,
  defaultAreaUnits: AreaUnitSchema,
  defaultDBHUnits: DimensionUnitSchema,
  defaultHOMUnits: DimensionUnitSchema
});

const QuadratRowSchema = z.object({
  quadratName: z.string().trim().min(1),
  startX: z.number(),
  startY: z.number(),
  dimensionX: z.number().positive(),
  dimensionY: z.number().positive()
});

const GridQuadratsSchema = z.object({
  mode: z.literal('grid'),
  quadratSizeX: z.number().positive(),
  quadratSizeY: z.number().positive(),
  namingPattern: z.enum(['sequential', 'row-col'])
});

const NoneQuadratsSchema = z.object({ mode: z.literal('none') });

/** StartX/StartY are the quadrat's south-west corner, measured from the plot's south-west origin. */
export const ProvisioningQuadratsSchema = z.discriminatedUnion('mode', [
  GridQuadratsSchema,
  z.object({
    mode: z.literal('csv'),
    rows: z.array(QuadratRowSchema).min(1).max(MAX_GENERATED_QUADRATS),
    overlapAcknowledgment: QuadratOverlapAcknowledgmentSchema.optional()
  }),
  NoneQuadratsSchema
]);

/**
 * The single entry point for provisioning input, whether it arrives from a client POST or from a
 * stored `catalog.provisioning_runs.InputPayload` row after `JSON.parse`. It validates only —
 * coordinates are never rewritten — so parsing an already-stored payload is idempotent.
 */
export const ProvisioningInputSchema = z
  .object({
    site: ProvisioningSiteSchema,
    plot: ProvisioningPlotSchema,
    quadrats: ProvisioningQuadratsSchema
  })
  .superRefine((input, ctx) => {
    if (input.quadrats.mode === 'grid') {
      try {
        estimateGridQuadratCount(input.plot, input.quadrats);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Invalid quadrat grid';
        ctx.addIssue({
          code: 'custom',
          path: ['quadrats'],
          message
        });
      }
      return;
    }

    if (input.quadrats.mode !== 'csv') return;

    const rows = input.quadrats.rows;
    // Overlaps are warn-and-acknowledge, not fatal: real surveyed quadrats can overlap, so a
    // layout with overlapping footprints is valid provisioning input when the admin has
    // explicitly acknowledged them (the acknowledgment text travels in the stored payload).
    // Every other issue kind remains a hard validation error.
    const { fatalIssues, overlapSummary } = validateQuadratCollectionDetailed(rows, input.plot);
    const overlapsAcknowledged = overlapSummary !== null && acknowledgmentCoversLayout(input.quadrats.overlapAcknowledgment, overlapSummary.layoutSignature);
    for (const issue of fatalIssues) {
      ctx.addIssue({
        code: 'custom',
        path: ['quadrats', 'rows', issue.rowIndex],
        message: issue.message
      });
    }
    if (overlapSummary && !overlapsAcknowledged) {
      for (const pair of overlapSummary.pairs) {
        ctx.addIssue({
          code: 'custom',
          path: ['quadrats', 'rows'],
          message: `${pair.message} If the overlap reflects field measurements, confirm the overlap acknowledgment.`
        });
      }
    }
  });

type _AssertInputShape = z.output<typeof ProvisioningInputSchema> extends ProvisioningInput ? true : never;
const _assertInputShape: _AssertInputShape = true;
