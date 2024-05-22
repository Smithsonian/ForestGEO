import { getConn, runQuery } from "@/components/processors/processormacros";
import MapperFactory from "@/config/datamapper";
import { handleError } from "@/utils/errorhandler";
import { PoolConnection, format } from "mysql2/promise";
import { NextRequest, NextResponse } from "next/server";
import {
  generateInsertOperations,
  generateUpdateOperations,
  StemDimensionsViewQueryConfig,
  AllTaxonomiesViewQueryConfig,
  StemTaxonomiesViewQueryConfig,
} from '@/components/processors/processorhelperfunctions';
import { error } from "console";
// slugs SHOULD CONTAIN AT MINIMUM: schema, page, pageSize, plotID, censusID, (optional) quadratID
export async function GET(request: NextRequest, { params }: { params: { dataType: string, slugs?: string[] } }) {
  if (!params.slugs || params.slugs.length < 5) throw new Error("slugs not received.");
  const [schema, pageParam, pageSizeParam, plotID, censusID, quadratID] = params.slugs;
  if ((!schema || schema === 'undefined') || (!pageParam || pageParam === 'undefined') || (!pageSizeParam || pageSizeParam === 'undefined')) throw new Error("core slugs schema/page/pageSize not correctly received");
  const page = parseInt(pageParam);
  const pageSize = parseInt(pageSizeParam);

  if ((!plotID || plotID === '0') || (!censusID || censusID === '0')) throw new Error("Core plot/census information not received");
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
      case 'quadratpersonnel':
        paginatedQuery = `SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.${params.dataType} LIMIT ?, ?`;
        break;
      case 'quadrats':
        paginatedQuery = `
        SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.${params.dataType} 
        WHERE PlotID = ${plotID} AND CensusID = ${censusID} 
        GROUP BY QuadratID
        LIMIT ?, ?`; // plotID, censusID, and quadratID are still strings!
        break;
      case 'subquadrats':
        // quadrats are required!
        if (quadratID === '0' || quadratID === 'undefined') throw new Error("QuadratID must be provided as part of slug fetch query, referenced fixeddata slug route");
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
        WHERE PlotID = ${plotID} AND CensusID = ${censusID} 
        ${quadratID && quadratID !== '0' && quadratID !== 'undefined' ? `AND QuadratID = ${quadratID}` : ''}
        LIMIT ?, ?
        `;
        break;
    }
    const paginatedResults = await runQuery(conn, paginatedQuery, queryParams);
    const totalRowsQuery = "SELECT FOUND_ROWS() as totalRows";
    const totalRowsResult = await runQuery(conn, totalRowsQuery);
    const totalRows = totalRowsResult[0].totalRows;
    const mapper = MapperFactory.getMapper<any, any>(params.dataType);
    const rows = mapper.mapData(paginatedResults);
    return new NextResponse(JSON.stringify({ output: rows, totalCount: totalRows }), { status: 200 });
  } catch (error: any) {
    if (conn) await conn.rollback();
    throw new Error(error);
  } finally {
    if (conn) conn.release();
  }
}

// required dynamic parameters: dataType (fixed),[ schema, gridID value] -> slugs
export async function POST(request: NextRequest, { params }: { params: { dataType: string, slugs?: string[] } }) {
  if (!params.slugs) throw new Error("slugs not provided");
  const [schema, gridID] = params.slugs;
  if (!schema || !gridID) throw new Error("no schema or gridID provided");
  let conn: PoolConnection | null = null;
  const { newRow } = await request.json();
  try {
    conn = await getConn();
    await conn.beginTransaction();
    if (Object.keys(newRow).includes('isNew')) delete newRow.isNew;
    const mapper = MapperFactory.getMapper<any, any>(params.dataType);
    const newRowData = mapper.demapData([newRow])[0];
    let demappedGridID = gridID.charAt(0).toUpperCase() + gridID.substring(1);

    if (params.dataType.includes('view')) {
      let queryConfig;
      switch (params.dataType) {
        case 'stemdimensionsview':
          queryConfig = StemDimensionsViewQueryConfig;
          break;
        case 'alltaxonomiesview':
          queryConfig = AllTaxonomiesViewQueryConfig;
          break;
        case 'stemtaxonomiesview':
          queryConfig = StemTaxonomiesViewQueryConfig;
          break;
        default:
          throw new Error("incorrect view call");
      }
      const insertQueries = generateInsertOperations(schema, newRow, queryConfig);
      for (const query of insertQueries) {
        await runQuery(conn, query);
      }
    } else if (params.dataType === 'attributes') {
      const insertQuery = format('INSERT INTO ?? SET ?', [`${schema}.${params.dataType}`, newRowData]);
      await runQuery(conn, insertQuery);
    } else {
      delete newRowData[demappedGridID];
      const insertQuery = format('INSERT INTO ?? SET ?', [`${schema}.${params.dataType}`, newRowData]);
      await runQuery(conn, insertQuery);
    }
    await conn.commit();
    return NextResponse.json({ message: "Insert successful" }, { status: 200 });
  } catch (error: any) {
    return handleError(error, conn, newRow);
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
  const { newRow, oldRow } = await request.json();
  try {
    conn = await getConn();
    await conn.beginTransaction();
    if (!['alltaxonomiesview', 'stemdimensionsview', 'stemtaxonomiesview', 'measurementssummaryview'].includes(params.dataType)) {
      const mapper = MapperFactory.getMapper<any, any>(params.dataType);
      const newRowData = mapper.demapData([newRow])[0];
      const oldRowData = mapper.demapData([oldRow])[0];
      const { [demappedGridID]: gridIDKey, ...remainingProperties } = newRowData;
      const updateQuery = format(`UPDATE ?? SET ? WHERE ?? = ?`, [`${schema}.${params.dataType}`, remainingProperties, demappedGridID, gridIDKey]);
      await runQuery(conn, updateQuery);
      await conn.commit();
    } else {
      let queryConfig;
      switch (params.dataType) {
        case 'stemdimensionsview':
          queryConfig = StemDimensionsViewQueryConfig;
          break;
        case 'alltaxonomiesview':
          queryConfig = AllTaxonomiesViewQueryConfig;
          break;
        case 'stemtaxonomiesview':
          queryConfig = StemTaxonomiesViewQueryConfig;
          break;
        default:
          throw new Error("incorrect view call");
      }
      const updateQueries = generateUpdateOperations(schema, newRow, oldRow, queryConfig);
      for (const query of updateQueries) {
        await runQuery(conn, query);
      }
      await conn.commit();
    }
    return NextResponse.json({ message: "Update successful" }, { status: 200 });
  } catch (error: any) {
    return handleError(error, conn, newRow);
  } finally {
    if (conn) conn.release();
  }
}

// Define mappings for views to base tables and primary keys
const viewToTableMappings: Record<string, { table: string, primaryKey: string }> = {
  'alltaxonomiesview': { table: 'species', primaryKey: 'SpeciesID' },
  'stemdimensionsview': { table: 'stems', primaryKey: 'StemID' },
  'stemtaxonomiesview': { table: 'stems', primaryKey: 'StemID' },
  'measurementssummaryview': { table: 'coremeasurements', primaryKey: 'CoreMeasurementID' },
};

// slugs: schema, gridID
// body: full data row, only need first item from it this time though
export async function DELETE(request: NextRequest, { params }: { params: { dataType: string, slugs?: string[] } }) {
  if (!params.slugs) throw new Error("slugs not provided");
  const [schema, gridID] = params.slugs;
  if (!schema || !gridID) throw new Error("no schema or gridID provided");
  let conn: PoolConnection | null = null;
  let demappedGridID = gridID.charAt(0).toUpperCase() + gridID.substring(1);
  const { newRow } = await request.json();
  try {
    conn = await getConn();
    await conn.beginTransaction();

    // Handle deletion for views
    if (['alltaxonomiesview', 'stemdimensionsview', 'stemtaxonomiesview', 'measurementssummaryview'].includes(params.dataType)) {
      const mapper = MapperFactory.getMapper<any, any>(params.dataType);
      const deleteRowData = mapper.demapData([newRow])[0];
      const viewConfig = viewToTableMappings[params.dataType];
      if (!viewConfig) throw new Error(`No table mapping found for view ${params.dataType}`);

      const { [viewConfig.primaryKey]: primaryKeyValue } = deleteRowData;
      if (!primaryKeyValue) throw new Error(`Primary key value missing for ${viewConfig.primaryKey} in view ${params.dataType}`);

      const deleteQuery = format(`DELETE FROM ?? WHERE ?? = ?`, [`${schema}.${viewConfig.table}`, viewConfig.primaryKey, primaryKeyValue]);
      await runQuery(conn, deleteQuery);
      await conn.commit();
      return NextResponse.json({ message: "Delete successful" }, { status: 200 });
    }
    // Handle deletion for tables
    const mapper = MapperFactory.getMapper<any, any>(params.dataType);
    const deleteRowData = mapper.demapData([newRow])[0];
    const { [demappedGridID]: gridIDKey, ...remainingProperties } = deleteRowData;
    const deleteQuery = format(`DELETE FROM ?? WHERE ?? = ?`, [`${schema}.${params.dataType}`, demappedGridID, gridIDKey]);
    await runQuery(conn, deleteQuery);
    await conn.commit();
    return NextResponse.json({ message: "Delete successful" }, { status: 200 });
  } catch (error: any) {
    return handleError(error, conn, newRow);
  } finally {
    if (conn) conn.release();
  }
}
