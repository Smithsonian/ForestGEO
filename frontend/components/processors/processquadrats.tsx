import { createError, handleUpsert } from '@/config/utils';
import { CensusQuadratResult, QuadratResult } from '@/config/sqlrdsdefinitions/zones';
import { SpecialProcessingProps } from '@/config/macros';

export async function processQuadrats(props: Readonly<SpecialProcessingProps>) {
  const { connectionManager, rowData, schema, plot, census } = props;
  if (!plot || !census) throw createError('missing core data', { plot, census });

  const { quadrat, startx, starty, dimx, dimy, area, quadratshape } = rowData;

  try {
    const quadratsData: Partial<QuadratResult> = {
      QuadratName: quadrat,
      PlotID: plot.plotID,
      StartX: startx,
      StartY: starty,
      DimensionX: dimx,
      DimensionY: dimy,
      Area: area,
      QuadratShape: quadratshape
    };

    const { id: quadratID } = await handleUpsert<QuadratResult>(connectionManager, schema, 'quadrats', quadratsData, 'QuadratID');
    if (!quadratID) throw createError('upsert failure for row: ', { quadratsData });

    // need to update censusquadrat

    const cqData = {
      CensusID: census.dateRanges[0].censusID,
      QuadratID: quadratID
    };
    const { id: cqID } = await handleUpsert<CensusQuadratResult>(connectionManager, schema, 'censusquadrat', cqData, 'CQID');
    if (!cqID) throw createError('upsert failure on censusquadrat for row: ', { cqData });

    return quadratID;
  } catch (error: any) {
    console.error('Upsert failed:', error.message);
    throw createError('Upsert failed', { error });
  }
}
