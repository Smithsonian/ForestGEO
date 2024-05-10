// dynamic structuring attempt
// dataType will be the table or view name reference to be placed as part of the request
// slugs is a catchall that will vary depending on the type of request placed
import { getConn, runQuery } from "@/components/processors/processormacros";
import MapperFactory from "@/config/datamapper";
import { PoolConnection, format } from "mysql2/promise";
import { NextRequest, NextResponse } from "next/server";

// slugs SHOULD CONTAIN AT MINIMUM: schema, page, pageSize, plotID, censusID, (optional) quadratID
export async function GET(request: NextRequest, { params }: { params: { dataType: string, slugs?: string[] } }) {
  if (!params.slugs || params.slugs.length < 5) throw new Error("slugs not received.");
  const [schema, pageParam, pageSizeParam, plotID, censusID, quadratID] = params.slugs;
  if (!schema || !pageParam || !pageSizeParam) throw new Error("core slugs schema/page/pageSize not correctly received");
  const page = parseInt(pageParam);
  const pageSize = parseInt(pageSizeParam);

  if (!plotID || !censusID) throw new Error("Core plot/census information not received");
  let conn: PoolConnection | null = null;
  // app/api/fixeddata/get/[dataType]/[[...slugs]]/route.ts
  try {
    conn = await getConn();
    let paginatedQuery = ``;
    let queryParams = [];
    queryParams.push((page * pageSize).toString(), pageSize.toString());
    switch (params.dataType) {
      case 'attributes':
      case 'species':
      case 'personnel':
      case 'stems':
      case 'alltaxonomiesview':
      case 'stemtaxonomiesview':
        paginatedQuery = `SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.${params.dataType} LIMIT ?, ?`;
        break;
      case 'quadrats':
        paginatedQuery = `
        SELECT SQL_CALC_FOUND_ROWS q.*, 
        GROUP_CONCAT(JSON_OBJECT(
          'personnelID', p.PersonnelID,
          'firstName', p.FirstName,
          'lastName', p.LastName,
          'role', p.Role
        ) SEPARATOR ',') AS personnel
        FROM ${schema}.${params.dataType} q
        LEFT JOIN ${schema}.quadratpersonnel qp ON q.QuadratID = qp.QuadratID
        LEFT JOIN ${schema}.personnel p ON qp.PersonnelID = p.PersonnelID
        WHERE PlotID = ${plotID} AND CensusID = ${censusID}
        GROUP BY q.QuadratID
        LIMIT ?, ?`; // plotID, censusID, and quadratID are still strings!
        break;
      case 'subquadrats':
        paginatedQuery = `SELECT SQL_CALC_FOUND_ROWS s.*
        FROM ${schema}.${params.dataType} s
        JOIN ${schema}.quadrats q ON s.QuadratID = q.QuadratID
        WHERE q.QuadratID = ${quadratID} AND q.PlotID = ${plotID} AND q.CensusID = ${censusID}
        LIMIT ?, ?`;
        break;
      case 'census':
        paginatedQuery = `
        SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.${params.dataType}
        WHERE PlotID = ${plotID}
        LIMIT ?, ?`;
        break;
      case 'coremeasurements':
      case 'measurementssummaryview':
      case 'stemdimensionsview':
        paginatedQuery = `
        SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.${params.dataType}
        WHERE PlotID = ${plotID} AND CensusID = ${censusID} ${quadratID ? `AND QuadratID = ${quadratID}` : ``}
        LIMIT ?, ?
        `;
        break;
    }
    console.log('paginatedQuery: ', paginatedQuery);
    const paginatedResults = await runQuery(conn, paginatedQuery, queryParams);
    console.log('unmapped results: ', paginatedResults);
    const totalRowsQuery = "SELECT FOUND_ROWS() as totalRows";
    const totalRowsResult = await runQuery(conn, totalRowsQuery);
    const totalRows = totalRowsResult[0].totalRows;
    const mapper = MapperFactory.getMapper<any, any>(params.dataType);
    const rows = mapper.mapData(paginatedResults);
    console.log('mapped results: ', rows);
    return new NextResponse(JSON.stringify({ output: rows, totalCount: totalRows }), { status: 200 });
  } catch (error: any) {
    if (conn) await conn.rollback();
    throw new Error(error);
  } finally {
    if (conn) conn.release();
  }
}

// required dynamic parameters: dataType (fixed),[ schema, gridID value] -> slugs
// Key note --> the gridID string parameter needs to correspond to the data type ..Result type, not the ...RDS type! (first letter needs to be capitalized!)
// json body-provided oldRow, newRow --> oldRow object is removed
export async function POST(request: NextRequest, { params }: { params: { dataType: string, slugs?: string[] } }) {
  if (!params.slugs) throw new Error("slugs not provided");
  const [schema, gridID] = params.slugs;
  if (!schema || !gridID) throw new Error("no schema or gridID provided");
  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    await conn.beginTransaction();
    const { newRow } = await request.json();
    if (Object.keys(newRow).includes('isNew')) delete newRow.isNew;
    console.log('POST newRow: ', newRow);
    const mapper = MapperFactory.getMapper<any, any>(params.dataType);
    const newRowData = mapper.demapData([newRow])[0];
    let demappedGridID = gridID.charAt(0).toUpperCase() + gridID.substring(1);
    if (params.dataType.includes('view')) {
      // views --> should not be handled in the same sense
    } else if (params.dataType === 'quadrats') {
      const { Personnel, ...coreNewRowData } = newRowData;
      delete coreNewRowData[demappedGridID]; // when inserting, we need to remove primary auto-incrementing key from new row EXCEPT FOR attributes, where Code is required
      const result = await runQuery(conn, 'INSERT INTO ?? SET ?', [`${schema}.${params.dataType}`, coreNewRowData]);
      const quadratID = result.insertId;
      if (Personnel && Personnel.length > 0) {
        for (const person of Personnel) {
          const insertPersonnelQuery = format('INSERT INTO ?? (QuadratID, PersonnelID) VALUES (?, ?)', [`${schema}.quadratpersonnel`, quadratID, person.PersonnelID]);
          await runQuery(conn, insertPersonnelQuery);
        }
      }
    } else if (params.dataType === 'attributes') {
      const insertAttributeQuery = format('INSERT INTO ?? SET ?', [`${schema}.${params.dataType}`, newRowData]);
      await runQuery(conn, insertAttributeQuery);
    } else {
      console.log(newRowData);
      delete newRowData[demappedGridID];
      console.log('new: ', newRowData);
      const insertQuery = format('INSERT INTO ?? SET ?', [`${schema}.${params.dataType}`, newRowData]);
      await runQuery(conn, insertQuery);
    }
    await conn.commit();
    return NextResponse.json({ message: "Insert successful" }, { status: 200 });
  } catch (error: any) {
    throw new Error(error);
  } finally {
    if (conn) conn.release();
  }
}

// slugs: schema, gridID
export async function PATCH(request: NextRequest, { params }: { params: { dataType: string, slugs?: string[] } }) {
  if (!params.slugs) throw new Error("slugs not provided");
  const [schema, gridID] = params.slugs;
  if (!schema || !gridID) throw new Error("no schema or gridID provided");
  let conn: PoolConnection | null = null;
  let demappedGridID = gridID.charAt(0).toUpperCase() + gridID.substring(1);
  try {
    conn = await getConn();
    await conn.beginTransaction();
    const { newRow } = await request.json();
    if (!['alltaxonomiesview', 'stemdimensionsview', 'stemtaxonomiesview', 'measurementssummaryview'].includes(params.dataType)) {
      const mapper = MapperFactory.getMapper<any, any>(params.dataType);
      const newRowData = mapper.demapData([newRow])[0];
      const { [demappedGridID]: gridIDKey, ...remainingProperties } = newRowData;
      const updateQuery = format(`UPDATE ?? SET ? WHERE ?? = ?`, [`${schema}.${params.dataType}`, remainingProperties, demappedGridID, gridIDKey]);
      console.log(updateQuery);
      await runQuery(conn, updateQuery);
      await conn.commit();
    }
    return NextResponse.json({ message: "Update successful" }, { status: 200 });
  } catch (error: any) {
    await conn?.rollback();
  } finally {
    if (conn) conn.release();
  }
}

// slugs: schema, gridID
// body: full data row, only need first item from it this time though
export async function DELETE(request: NextRequest, { params }: { params: { dataType: string, slugs?: string[] } }) {
  if (!params.slugs) throw new Error("slugs not provided");
  const [schema, gridID] = params.slugs;
  if (!schema || !gridID) throw new Error("no schema or gridID provided");
  let conn: PoolConnection | null = null;
  let demappedGridID = gridID.charAt(0).toUpperCase() + gridID.substring(1);
  try {
    conn = await getConn();
    await conn.beginTransaction();
    const { newRow } = await request.json();
    console.log('delete newrow: ', newRow);
    if (!['alltaxonomiesview', 'stemdimensionsview', 'stemtaxonomiesview', 'measurementssummaryview'].includes(params.dataType)){
      const mapper = MapperFactory.getMapper<any, any>(params.dataType);
      const deleteRowData = mapper.demapData([newRow])[0];
      const { [demappedGridID]: gridIDKey, ...remainingProperties } = deleteRowData;
      const deleteQuery = format(`DELETE FROM ?? WHERE ?? = ?`, [`${schema}.${params.dataType}`, demappedGridID, gridIDKey]);
      await runQuery(conn, deleteQuery);
      await conn.commit();
      return NextResponse.json({ message: "Delete successful" }, { status: 200 });
    }
    return NextResponse.json({ message: "Delete successful" }, { status: 200 });
  } catch (error: any) {
    await conn?.rollback();
    throw error;
  } finally {
    if (conn) conn.release();
  }
}