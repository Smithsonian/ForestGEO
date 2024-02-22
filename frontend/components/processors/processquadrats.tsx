import {runQuery, SpecialProcessingProps} from "@/components/processors/processormacros";
import {getPersonnelIDByName} from "@/components/processors/processorhelperfunctions";

export async function processQuadrats(props: Readonly<SpecialProcessingProps>) {
  const {connection, rowData, plotID, censusID, fullName} = props;
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("Environmental variable extraction for schema failed");
  if (!plotID || !censusID || !fullName) throw new Error("Missing plotID or fullName");
  console.log('inside processQuadrats');
  /**
   * - quadrat: the name of the quadrat, e.g.0002
   * - startx: the x coordinate of the lower left corner of the quadrat, e.g. 0
   * - starty: the y coordinate of the lower left corner of the quadrat, e.g. 40
   * NOTE: The x and y coordinates (“startx” and “starty”) refer to the distance in meters between
   * the quadrat under question and lowest, left-most corner of the entire plot (or
   * wherever your plot origin, or 0,0 coordinates are).
   * - dimx: the x dimension of the quadrat (in meters), e.g. 20
   * - dimy: the y dimension of the quadrat (in meters), e.g. 20
   */

  try {
    console.log('processquadrats: beginning transaction');
    await connection.beginTransaction();
    const personnelID = await getPersonnelIDByName(connection, fullName);
    if (personnelID === null) throw new Error(`PersonnelID for personnel with name ${fullName} does not exist`);
    const query = `
      INSERT INTO ${schema}.Quadrats (PlotID, CensusID, PersonnelID, QuadratName, DimensionX, DimensionY, Area, QuadratShape)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?);
    `;
    await runQuery(connection, query, [
      plotID,
      censusID,
      personnelID,
      rowData.quadrat,
      rowData.dimx,
      rowData.dimy,
      null,
      null
    ]);
    console.log('processquadrats: no errors yet');
    await connection.commit();
    console.log('processquadrats: committed');
  } catch (error: any) {
    await connection.rollback();
    throw new Error(error);
  } finally {
    if (connection) connection.release();
  }
  return null;
}