import { z } from 'zod';
import { areaSelectionOptions, unitSelectionOptions } from '@/config/macros';
import { estimateGridQuadratCount, MAX_GENERATED_QUADRATS } from './grid-generator';
import { acknowledgmentCoversLayout, QUADRAT_OVERLAP_ACKNOWLEDGMENT_STATEMENT, validateQuadratCollectionDetailed } from './quadrat-collection-validation';
import type { ProvisioningInput } from './types';

const DimensionUnitSchema = z.enum(unitSelectionOptions);
const AreaUnitSchema = z.enum(areaSelectionOptions);

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
  globalX: z.number(),
  globalY: z.number(),
  globalZ: z.number(),
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
