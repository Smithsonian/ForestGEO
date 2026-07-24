import { z } from 'zod';
import { areaSelectionOptions, unitSelectionOptions } from '@/config/macros';
import { estimateGridQuadratCount, MAX_GENERATED_QUADRATS } from './grid-generator';
import { normalizeToSouthwest, REFERENCE_CORNER_OPTIONS } from './coordinate-reference-corner';
import { acknowledgmentCoversLayout, QUADRAT_OVERLAP_ACKNOWLEDGMENT_STATEMENT, validateQuadratCollectionDetailed } from './quadrat-collection-validation';
import type { ProvisioningRequestInput, ProvisioningRunInput, QuadratReferenceCorner } from './types';

const DimensionUnitSchema = z.enum(unitSelectionOptions);
const AreaUnitSchema = z.enum(areaSelectionOptions);

const CORNER_VALUES = REFERENCE_CORNER_OPTIONS.map(option => option.value) as [QuadratReferenceCorner, ...QuadratReferenceCorner[]];
const ReferenceCornerSchema = z.enum(CORNER_VALUES);
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

/** Request side. Rows are in the declared convention, so startX may exceed the plot. */
export const ProvisioningQuadratsRequestSchema = z.discriminatedUnion('mode', [
  GridQuadratsSchema,
  z.object({
    mode: z.literal('csv'),
    rows: z.array(QuadratRowSchema).min(1).max(MAX_GENERATED_QUADRATS),
    coordinateReferenceCorner: ReferenceCornerSchema,
    overlapAcknowledgment: QuadratOverlapAcknowledgmentSchema.optional()
  }),
  NoneQuadratsSchema
]);

/** Canonical side. Rows are south-west and must lie inside the plot. */
export const CanonicalQuadratsSchema = z.discriminatedUnion('mode', [
  GridQuadratsSchema,
  z.object({
    mode: z.literal('csv'),
    rows: z.array(QuadratRowSchema).min(1).max(MAX_GENERATED_QUADRATS),
    coordinates: z.literal('canonical-sw'),
    sourceCoordinateReferenceCorner: ReferenceCornerSchema,
    overlapAcknowledgment: QuadratOverlapAcknowledgmentSchema.optional()
  }),
  NoneQuadratsSchema
]);

export const ProvisioningRequestSchema = z.object({
  site: ProvisioningSiteSchema,
  plot: ProvisioningPlotSchema,
  quadrats: ProvisioningQuadratsRequestSchema
});

/**
 * Entry point for values that are ALREADY canonical south-west, e.g. a stored
 * `catalog.provisioning_runs.InputPayload` row after `JSON.parse` (and, for legacy rows,
 * `upgradeLegacyQuadratConfig`). It does NOT normalize a declared reference corner — it only
 * validates. Anything arriving from a client must go through `ProvisioningInputSchema` instead,
 * which normalizes first and then pipes into this schema. Running this schema's sibling
 * (`ProvisioningInputSchema`, which re-runs the normalizing `.transform()`) on already-canonical
 * rows would silently shift every quadrat by one more cell.
 */
export const CanonicalProvisioningSchema = z
  .object({
    site: ProvisioningSiteSchema,
    plot: ProvisioningPlotSchema,
    quadrats: CanonicalQuadratsSchema
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
    const { fatalIssues, overlapSummary } = validateQuadratCollectionDetailed(rows, input.plot, 'SW');
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

function canonicalizeProvisioningRequest(request: z.infer<typeof ProvisioningRequestSchema>): z.input<typeof CanonicalProvisioningSchema> {
  const { site, plot, quadrats } = request;

  if (quadrats.mode !== 'csv') {
    return { site, plot, quadrats };
  }

  const { coordinateReferenceCorner, rows, overlapAcknowledgment } = quadrats;
  return {
    site,
    plot,
    quadrats: {
      mode: 'csv',
      rows: rows.map(row => normalizeToSouthwest(row, coordinateReferenceCorner)),
      coordinates: 'canonical-sw',
      sourceCoordinateReferenceCorner: coordinateReferenceCorner,
      ...(overlapAcknowledgment !== undefined ? { overlapAcknowledgment } : {})
    }
  };
}

export const ProvisioningInputSchema = ProvisioningRequestSchema.transform(canonicalizeProvisioningRequest).pipe(CanonicalProvisioningSchema);

type _AssertRequestShape = z.input<typeof ProvisioningInputSchema> extends ProvisioningRequestInput ? true : never;
type _AssertRunShape = z.output<typeof ProvisioningInputSchema> extends ProvisioningRunInput ? true : never;
const _assertRequestShape: _AssertRequestShape = true;
const _assertRunShape: _AssertRunShape = true;
