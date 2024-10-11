import { SpecialProcessingProps } from '@/components/processors/processormacros';
import { createError, handleUpsert } from '@/config/utils';
import { CensusQuadratResult, QuadratResult } from '@/config/sqlrdsdefinitions/zones';

export async function processQuadrats(props: Readonly<SpecialProcessingProps>) {
  const { connection, rowData, schema, censusID } = props;
  if (!censusID) throw createError('CensusID missing', { censusID });

  const { quadrat, startx, starty, coordinateunit, dimx, dimy, dimensionunit, area, areaunit, quadratshape } = rowData;

  try {
    await connection.beginTransaction();
    const quadratsData = {
      QuadratName: quadrat,
      StartX: startx,
      StartY: starty,
      CoordinateUnit: coordinateunit,
      DimensionX: dimx,
      DimensionY: dimy,
      DimensionUnit: dimensionunit,
      Area: area,
      AreaUnit: areaunit,
      QuadratShape: quadratshape
    };

    const quadratID = await handleUpsert<QuadratResult>(connection, schema, 'quadrats', quadratsData, 'QuadratID');
    if (!quadratID) throw createError('upsert failure for row: ', { quadratsData });

    // need to update censusquadrat

    const cqData = {
      CensusID: censusID,
      QuadratID: quadratID
    };
    const cqID = await handleUpsert<CensusQuadratResult>(connection, schema, 'censusquadrat', cqData, 'CQID');
    if (!cqID) throw createError('upsert failure on censusquadrat for row: ', { cqData });

    await connection.commit();
    return quadratID;
  } catch (error: any) {
    await connection.rollback();
    console.error('Upsert failed:', error.message);
    throw createError('Upsert failed', { error });
  }
}
