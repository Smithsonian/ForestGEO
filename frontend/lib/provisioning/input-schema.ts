import { z } from 'zod';
import { estimateGridQuadratCount, MAX_GENERATED_QUADRATS } from './grid-generator';

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
  defaultDimensionUnits: z.string().min(1),
  defaultCoordinateUnits: z.string().min(1),
  defaultAreaUnits: z.string().min(1),
  defaultDBHUnits: z.string().min(1),
  defaultHOMUnits: z.string().min(1)
});

export const ProvisioningQuadratsSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('grid'),
    quadratSizeX: z.number().positive(),
    quadratSizeY: z.number().positive(),
    namingPattern: z.enum(['sequential', 'row-col'])
  }),
  z.object({
    mode: z.literal('csv'),
    rows: z
      .array(
        z.object({
          quadratName: z.string().min(1),
          startX: z.number().min(0),
          startY: z.number().min(0),
          dimensionX: z.number().positive(),
          dimensionY: z.number().positive()
        })
      )
      .min(1)
      .max(MAX_GENERATED_QUADRATS)
  })
]);

export const ProvisioningInputSchema = z
  .object({
    site: ProvisioningSiteSchema,
    plot: ProvisioningPlotSchema,
    quadrats: ProvisioningQuadratsSchema
  })
  .superRefine((input, ctx) => {
    if (input.quadrats.mode !== 'grid') return;

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
  });

export type ProvisioningInputType = z.infer<typeof ProvisioningInputSchema>;
