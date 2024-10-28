import { SpecialProcessingProps } from '@/components/processors/processormacros';
import { createError, handleUpsert } from '@/config/utils';
import { CensusQuadratResult, QuadratResult } from '@/config/sqlrdsdefinitions/zones';

export async function processQuadrats(props: Readonly<SpecialProcessingProps>) {
  const { connection, rowData, schema, plotID, censusID } = props;
  if (!censusID || !plotID) throw createError('CensusID missing', { censusID });

  const { quadrat, startx, starty, coordinateunit, dimx, dimy, dimensionunit, area, areaunit, quadratshape } = rowData;

  try {
    await connection.beginTransaction();
    const quadratsData: Partial<QuadratResult> = {
      QuadratName: quadrat,
      PlotID: plotID,
      StartX: startx,
      StartY: starty,
      CoordinateUnits: coordinateunit,
      DimensionX: dimx,
      DimensionY: dimy,
      DimensionUnits: dimensionunit,
      Area: area,
      AreaUnits: areaunit,
      QuadratShape: quadratshape
    };

    const { id: quadratID } = await handleUpsert<QuadratResult>(connection, schema, 'quadrats', quadratsData, 'QuadratID');
    if (!quadratID) throw createError('upsert failure for row: ', { quadratsData });

    // need to update censusquadrat

    const cqData = {
      CensusID: censusID,
      QuadratID: quadratID
    };
    const { id: cqID } = await handleUpsert<CensusQuadratResult>(connection, schema, 'censusquadrat', cqData, 'CQID');
    if (!cqID) throw createError('upsert failure on censusquadrat for row: ', { cqData });

    await connection.commit();
    return quadratID;
  } catch (error: any) {
    await connection.rollback();
    console.error('Upsert failed:', error.message);
    throw createError('Upsert failed', { error });
  }
}
