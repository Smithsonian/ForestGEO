import {getConn, runQuery} from "@/components/processors/processormacros";
import MapperFactory from "@/config/datamapper";
import {handleError} from "@/utils/errorhandler";
import {PoolConnection, format} from "mysql2/promise";
import {NextRequest, NextResponse} from "next/server";
import {
  generateInsertOperations,
  generateUpdateOperations,
  StemDimensionsViewQueryConfig,
  AllTaxonomiesViewQueryConfig,
  StemTaxonomiesViewQueryConfig,
} from '@/components/processors/processorhelperfunctions';
import { HTTPResponses } from "@/config/macros";

// slugs SHOULD CONTAIN AT MINIMUM: schema, page, pageSize, plotID, plotCensusNumber, (optional) quadratID
export async function GET(request: NextRequest, {params}: {
  params: { dataType: string, slugs?: string[] }
}): Promise<NextResponse<{ output: any[], deprecated?: any[], totalCount: number }>> {
  if (!params.slugs || params.slugs.length < 5) throw new Error("slugs not received.");
  const [schema, pageParam, pageSizeParam, plotIDParam, plotCensusNumberParam, quadratIDParam] = params.slugs;
  if ((!schema || schema === 'undefined') || (!pageParam || pageParam === 'undefined') || (!pageSizeParam || pageSizeParam === 'undefined')) throw new Error("core slugs schema/page/pageSize not correctly received");
  const page = parseInt(pageParam);
  const pageSize = parseInt(pageSizeParam);

  if ((!plotIDParam || plotIDParam === '0') || (!plotCensusNumberParam || plotCensusNumberParam === '0')) throw new Error("Core plot/census information not received");
  const plotID = parseInt(plotIDParam);
  const plotCensusNumber = parseInt(plotCensusNumberParam);
  const quadratID = quadratIDParam ? parseInt(quadratIDParam) : undefined;
  let conn: PoolConnection | null = null;
  let updatedMeasurementsExist = false;
  let censusIDs;
  let mostRecentCensusID: any;
  let pastCensusIDs: string | any[];

  try {
    conn = await getConn();
    let paginatedQuery = ``;
    const queryParams: any[] = [];

    switch (params.dataType) {
      case 'attributes':
      case 'species':
      case 'personnel':
      case 'stems':
      case 'alltaxonomiesview':
      case 'stemtaxonomiesview':
      case 'quadratpersonnel':
        paginatedQuery = `
          SELECT SQL_CALC_FOUND_ROWS * 
          FROM ${schema}.${params.dataType} 
          LIMIT ?, ?`;
        queryParams.push(page * pageSize, pageSize);
        break;
      case 'quadrats':
        paginatedQuery = `
          SELECT SQL_CALC_FOUND_ROWS q.*
          FROM ${schema}.quadrats q
          WHERE q.PlotID = ?
            AND q.CensusID IN (
              SELECT c.CensusID
              FROM ${schema}.census c
              WHERE c.PlotID = q.PlotID
                AND c.PlotCensusNumber = ?
            )
          GROUP BY q.QuadratID
          LIMIT ?, ?`;
        queryParams.push(plotID, plotCensusNumber, page * pageSize, pageSize);
        break;
      case 'subquadrats':
        if (!quadratID || quadratID === 0) {
          throw new Error("QuadratID must be provided as part of slug fetch query, referenced fixeddata slug route");
        }
        paginatedQuery = `
          SELECT SQL_CALC_FOUND_ROWS s.*
          FROM ${schema}.subquadrats s
          JOIN ${schema}.quadrats q ON s.QuadratID = q.QuadratID
          WHERE q.QuadratID = ?
            AND q.PlotID = ?
            AND q.CensusID IN (
              SELECT c.CensusID
              FROM ${schema}.census c
              WHERE c.PlotID = q.PlotID
                AND c.PlotCensusNumber = ?
            )
          LIMIT ?, ?`;
        queryParams.push(quadratID, plotID, plotCensusNumber, page * pageSize, pageSize);
        break;
      case 'census':
        paginatedQuery = `
          SELECT SQL_CALC_FOUND_ROWS * 
          FROM ${schema}.census 
          WHERE PlotID = ?
          LIMIT ?, ?`;
        queryParams.push(plotID, page * pageSize, pageSize);
        break;
      case 'coremeasurements':
      case 'measurementssummaryview':
      case 'stemdimensionsview':
        // Retrieve multiple past CensusID for the given PlotCensusNumber
        const censusQuery = `
          SELECT CensusID
          FROM ${schema}.census
          WHERE PlotID = ?
            AND PlotCensusNumber = ?
          ORDER BY StartDate DESC
          LIMIT 30
        `;
        const censusResults = await runQuery(conn, format(censusQuery, [plotID, plotCensusNumber]));
        if (censusResults.length < 2) {
          paginatedQuery = `
          SELECT SQL_CALC_FOUND_ROWS *
          FROM ${schema}.${params.dataType} cm
          WHERE PlotID = ?
            AND CensusID IN (
              SELECT c.CensusID
              FROM ${schema}.census c
              WHERE c.PlotID = PlotID
                AND c.PlotCensusNumber = ?
            )
          LIMIT ?, ?`;
          queryParams.push(plotID, plotCensusNumber, page * pageSize, pageSize);
          break;
        } else {
          updatedMeasurementsExist = true;
          censusIDs = censusResults.map((c: any) => c.CensusID);
          mostRecentCensusID = censusIDs[0];
          pastCensusIDs = censusIDs.slice(1);
          // Query to fetch paginated measurements from measurementssummaryview
          paginatedQuery = `
            SELECT SQL_CALC_FOUND_ROWS *
            FROM ${schema}.measurementssummaryview
            WHERE PlotID = ?
              AND CensusID IN (${censusIDs.map(() => '?').join(', ')})
            LIMIT ?, ?
          `;
          queryParams.push(plotID, ...censusIDs, page * pageSize, pageSize);
          break;
        }
      default:
        throw new Error(`Unknown dataType: ${params.dataType}`);
    }

    // Ensure query parameters match the placeholders in the query
    if (paginatedQuery.match(/\?/g)?.length !== queryParams.length) {
      throw new Error("Mismatch between query placeholders and parameters");
    }

    const paginatedResults = await runQuery(conn, format(paginatedQuery, queryParams));

    const totalRowsQuery = "SELECT FOUND_ROWS() as totalRows";
    const totalRowsResult = await runQuery(conn, totalRowsQuery);
    const totalRows = totalRowsResult[0].totalRows;

    if (updatedMeasurementsExist) {
      // Separate deprecated and non-deprecated rows
      const deprecated = paginatedResults.filter((row: any) => pastCensusIDs.includes(row.CensusID));

      // Ensure deprecated measurements are duplicates
      const uniqueKeys = ['PlotID', 'QuadratID', 'TreeID', 'StemID']; // Define unique keys that should match
      const outputKeys = paginatedResults.map((row: any) =>
        uniqueKeys.map((key) => row[key]).join('|')
      );
      const filteredDeprecated = deprecated.filter((row: any) =>
        outputKeys.includes(uniqueKeys.map((key) => row[key]).join('|'))
      );
      // Map data using the appropriate mapper
      const mapper = MapperFactory.getMapper<any, any>(params.dataType);
      const deprecatedRows = mapper.mapData(filteredDeprecated);
      const rows = mapper.mapData(paginatedResults);
      return new NextResponse(JSON.stringify({
        output: rows,
        deprecated: deprecatedRows,
        totalCount: totalRows
      }), {status: 200});
    } else {
      const mapper = MapperFactory.getMapper<any, any>(params.dataType);
      const rows = mapper.mapData(paginatedResults);
      return new NextResponse(JSON.stringify({
        output: rows,
        deprecated: undefined,
        totalCount: totalRows
      }), {status: 200});
    }
  } catch (error: any) {
    if (conn) await conn.rollback();
    throw new Error(error);
  } finally {
    if (conn) conn.release();
  }
}

// required dynamic parameters: dataType (fixed),[ schema, gridID value] -> slugs
export async function POST(request: NextRequest, {params}: { params: { dataType: string, slugs?: string[] } }) {
  if (!params.slugs) throw new Error("slugs not provided");
  const [schema, gridID] = params.slugs;
  if (!schema || !gridID) throw new Error("no schema or gridID provided");
  let conn: PoolConnection | null = null;
  const {newRow} = await request.json();
  try {
    conn = await getConn();
    await conn.beginTransaction();
    if (Object.keys(newRow).includes('isNew')) delete newRow.isNew;
    const mapper = MapperFactory.getMapper<any, any>(params.dataType);
    const newRowData = mapper.demapData([newRow])[0];
    const demappedGridID = gridID.charAt(0).toUpperCase() + gridID.substring(1);

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
      if (params.dataType === 'plots') delete newRowData.NumQuadrats;
      const insertQuery = format('INSERT INTO ?? SET ?', [`${schema}.${params.dataType}`, newRowData]);
      await runQuery(conn, insertQuery);
    }
    await conn.commit();
    return NextResponse.json({message: "Insert successful"}, {status: 200});
  } catch (error: any) {
    return handleError(error, conn, newRow);
  } finally {
    if (conn) conn.release();
  }
}

// slugs: schema, gridID
export async function PATCH(request: NextRequest, {params}: { params: { dataType: string, slugs?: string[] } }) {
  if (!params.slugs) throw new Error("slugs not provided");
  const [schema, gridID] = params.slugs;
  if (!schema || !gridID) throw new Error("no schema or gridID provided");
  let conn: PoolConnection | null = null;
  const demappedGridID = gridID.charAt(0).toUpperCase() + gridID.substring(1);
  const {newRow, oldRow} = await request.json();
  try {
    conn = await getConn();
    await conn.beginTransaction();
    if (!['alltaxonomiesview', 'stemdimensionsview', 'stemtaxonomiesview', 'measurementssummaryview'].includes(params.dataType)) {
      const mapper = MapperFactory.getMapper<any, any>(params.dataType);
      const newRowData = mapper.demapData([newRow])[0];
      const {[demappedGridID]: gridIDKey, ...remainingProperties} = newRowData;
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
    return NextResponse.json({message: "Update successful"}, {status: 200});
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
  const demappedGridID = gridID.charAt(0).toUpperCase() + gridID.substring(1);
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
    if (error.code === 'ER_ROW_IS_REFERENCED_2') {
      const referencingTableMatch = error.message.match(/CONSTRAINT `(.*?)` FOREIGN KEY \(`(.*?)`\) REFERENCES `(.*?)`/);
      const referencingTable = referencingTableMatch ? referencingTableMatch[3] : 'unknown';
      return NextResponse.json({ message: "Foreign key conflict detected", referencingTable }, { status: HTTPResponses.FOREIGN_KEY_CONFLICT });
    }
    return handleError(error, conn, newRow);
  } finally {
    if (conn) conn.release();
  }
}