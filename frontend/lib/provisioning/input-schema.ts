import { z } from 'zod';

export const ProvisioningInputSchema = z.object({
  site: z.object({
    siteName: z.string().min(1),
    schemaName: z.string().regex(/^forestgeo_[a-z0-9_]+$/),
    sqDimX: z.number().int().positive(),
    sqDimY: z.number().int().positive(),
    defaultUOMDBH: z.string().min(1),
    defaultUOMHOM: z.string().min(1),
    doubleDataEntry: z.boolean(),
    location: z.string().min(1),
    country: z.string().min(1)
  }),
  plot: z.object({
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
  }),
  quadrats: z.discriminatedUnion('mode', [
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
    })
  ])
});

export type ProvisioningInputType = z.infer<typeof ProvisioningInputSchema>;
