import MapperFactory from '@/config/datamapper';
import { handleError } from '@/utils/errorhandler';
import { format } from 'mysql2/promise';
import { NextRequest, NextResponse } from 'next/server';
import { AllTaxonomiesViewQueryConfig, handleDeleteForSlices, handleUpsertForSlices } from '@/components/processors/processorhelperfunctions';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';
export { PATCH } from '@/config/macros/coreapifunctions';

// slugs SHOULD CONTAIN AT MINIMUM: schema, page, pageSize, plotID, plotCensusNumber, (optional) quadratID, (optional) speciesID
export async function GET(
  _request: NextRequest,
  props: {
    params: Promise<{ dataType: string; slugs?: string[] }>;
  }
): Promise<NextResponse<{ output: any[]; deprecated?: any[]; totalCount: number; finishedQuery: string }>> {
  const params = await props.params;
  if (!params.slugs || params.slugs.length < 5) throw new Error('slugs not received.');
  const [schema, pageParam, pageSizeParam, plotIDParam, plotCensusNumberParam, speciesIDParam] = params.slugs;
  if (!schema || schema === 'undefined' || !pageParam || pageParam === 'undefined' || !pageSizeParam || pageSizeParam === 'undefined')
    throw new Error('core slugs schema/page/pageSize not correctly received');
  const page = parseInt(pageParam);
  const pageSize = parseInt(pageSizeParam);
  const plotID = plotIDParam ? parseInt(plotIDParam) : undefined;
  const plotCensusNumber = plotCensusNumberParam ? parseInt(plotCensusNumberParam) : undefined;
  const speciesID = speciesIDParam ? parseInt(speciesIDParam) : undefined;

  const connectionManager = ConnectionManager.getInstance();

  try {
    let paginatedQuery = ``;
    const queryParams: any[] = [];

    switch (params.dataType) {
      case 'sitesspecificvalidations':
        paginatedQuery = `
          SELECT SQL_CALC_FOUND_ROWS * 
          FROM ${schema}.sitespecificvalidations LIMIT ?, ?;`; // validation procedures is special
        queryParams.push(page * pageSize, pageSize);
        break;
      case 'specieslimits':
        paginatedQuery = `SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.${params.dataType} pdt WHERE pdt.SpeciesID = ? LIMIT ?, ?`;
        queryParams.push(speciesID, page * pageSize, pageSize);
        break;
      case 'unifiedchangelog':
        paginatedQuery = `
            SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.${params.dataType} uc
            JOIN ${schema}.plots p ON uc.PlotID = p.PlotID
            JOIN ${schema}.census c ON uc.CensusID = c.CensusID
            WHERE p.PlotID = ?
            AND c.PlotCensusNumber = ? LIMIT ?, ?;`;
        queryParams.push(plotID, plotCensusNumber, page * pageSize, pageSize);
        break;
      case 'failedmeasurements':
        paginatedQuery = `SELECT SQL_CALC_FOUND_ROWS fm.* FROM ${schema}.${params.dataType} fm
          JOIN ${schema}.census c ON fm.CensusID = c.CensusID
          WHERE fm.PlotID = ? 
          AND c.PlotCensusNumber = ? LIMIT ?, ?;`;
        queryParams.push(plotID, plotCensusNumber, page * pageSize, pageSize);
        break;
      case 'viewfulltable':
        paginatedQuery = `SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.${params.dataType} WHERE PlotID = ? AND PlotCensusNumber = ? LIMIT ?, ?`;
        queryParams.push(plotID, plotCensusNumber, page * pageSize, pageSize);
        break;
      case 'attributes':
      case 'species':
      case 'stems':
      case 'alltaxonomiesview':
      case 'quadratpersonnel':
      case 'roles':
        paginatedQuery = `SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.${params.dataType} LIMIT ?, ?`;
        queryParams.push(page * pageSize, pageSize);
        break;
      case 'personnel':
        paginatedQuery = `
            SELECT SQL_CALC_FOUND_ROWS p.*
            FROM ${schema}.${params.dataType} p
                     JOIN ${schema}.census c ON p.CensusID = c.CensusID
            WHERE c.PlotID = ?
              AND c.PlotCensusNumber = ? LIMIT ?, ?;`;
        queryParams.push(plotID, plotCensusNumber, page * pageSize, pageSize);
        break;
      case 'quadrats':
        paginatedQuery = `
            SELECT SQL_CALC_FOUND_ROWS q.*
            FROM ${schema}.quadrats q
                     JOIN ${schema}.censusquadrat cq ON q.QuadratID = cq.QuadratID
                     JOIN ${schema}.census c ON cq.CensusID = c.CensusID
            WHERE q.PlotID = ?
              AND c.PlotID = ?
              AND c.PlotCensusNumber = ? LIMIT ?, ?;`;
        queryParams.push(plotID, plotID, plotCensusNumber, page * pageSize, pageSize);
        break;
      case 'personnelrole':
        paginatedQuery = `
        SELECT SQL_CALC_FOUND_ROWS 
            p.PersonnelID,
            p.CensusID,
            p.FirstName,
            p.LastName,
            r.RoleName,
            r.RoleDescription
        FROM 
            personnel p
        LEFT JOIN 
            roles r ON p.RoleID = r.RoleID
            census c ON p.CensusID = c.CensusID
        WHERE c.PlotID = ? AND c.PlotCensusNumber = ? LIMIT ?, ?;`;
        queryParams.push(plotID, plotCensusNumber, page * pageSize, pageSize);
        break;
      case 'census':
        paginatedQuery = `
            SELECT SQL_CALC_FOUND_ROWS *
            FROM ${schema}.census
            WHERE PlotID = ? LIMIT ?, ?`;
        queryParams.push(plotID, page * pageSize, pageSize);
        break;
      default:
        throw new Error(`Unknown dataType: ${params.dataType}`);
    }

    // Ensure query parameters match the placeholders in the query
    if (paginatedQuery.match(/\?/g)?.length !== queryParams.length) {
      throw new Error('Mismatch between query placeholders and parameters');
    }
    const paginatedResults = await connectionManager.executeQuery(format(paginatedQuery, queryParams));
    paginatedResults.forEach((result: any) => {
      if (result.UserDefinedFields !== undefined && result.UserDefinedFields !== null) {
        if (typeof result.UserDefinedFields === 'string') {
          result.UserDefinedFields = JSON.parse(result.UserDefinedFields).treestemstate;
        } else result.UserDefinedFields = result.UserDefinedFields.treestemstate;
      }
    });

    const totalRowsQuery = 'SELECT FOUND_ROWS() as totalRows';
    const totalRowsResult = await connectionManager.executeQuery(totalRowsQuery);
    const totalRows = totalRowsResult[0].totalRows;

    return new NextResponse(
      JSON.stringify({
        output: MapperFactory.getMapper<any, any>(params.dataType).mapData(paginatedResults),
        deprecated: undefined,
        totalCount: totalRows,
        finishedQuery: format(paginatedQuery, queryParams)
      }),
      { status: HTTPResponses.OK }
    );
  } catch (error: any) {
    throw new Error(error);
  } finally {
    await connectionManager.closeConnection();
  }
}

// required dynamic parameters: dataType (fixed),[ schema, gridID value] -> slugs
export async function POST(request: NextRequest, props: { params: Promise<{ dataType: string; slugs?: string[] }> }) {
  const params = await props.params;
  if (!params.slugs) throw new Error('slugs not provided');
  const [schema, gridID, _plotIDParam, censusIDParam] = params.slugs;
  if (!schema || !gridID) throw new Error('no schema or gridID provided');

  const censusID = censusIDParam ? parseInt(censusIDParam) : undefined;

  const connectionManager = ConnectionManager.getInstance();
  const { newRow } = await request.json();
  let insertIDs: Record<string, number> = {};
  let transactionID: string | undefined = undefined;
  try {
    transactionID = await connectionManager.beginTransaction();

    if (Object.keys(newRow).includes('isNew')) delete newRow.isNew;

    const newRowData = MapperFactory.getMapper<any, any>(params.dataType).demapData([newRow])[0];
    const demappedGridID = gridID.charAt(0).toUpperCase() + gridID.substring(1);

    // Handle SQL views with handleUpsertForSlices
    if (params.dataType.includes('view')) {
      let queryConfig;
      switch (params.dataType) {
        case 'alltaxonomiesview':
          queryConfig = AllTaxonomiesViewQueryConfig;
          break;
        default:
          throw new Error('Incorrect view call');
      }

      // Use handleUpsertForSlices and retrieve the insert IDs
      insertIDs = await handleUpsertForSlices(connectionManager, schema, newRowData, queryConfig);
    }
    // Handle the case for 'attributes'
    else if (params.dataType === 'attributes') {
      const insertQuery = format('INSERT INTO ?? SET ?', [`${schema}.${params.dataType}`, newRowData]);
      const results = await connectionManager.executeQuery(insertQuery);
      insertIDs = { attributes: results.insertId }; // Standardize output with table name as key
    }
    // Handle all other cases
    else {
      delete newRowData[demappedGridID];
      if (params.dataType === 'plots') delete newRowData.NumQuadrats;
      let insertQuery = '';
      if (params.dataType === 'failedmeasurements') insertQuery = format('INSERT IGNORE INTO ?? SET ?', [`${schema}.${params.dataType}`, newRowData]);
      else insertQuery = format('INSERT INTO ?? SET ?', [`${schema}.${params.dataType}`, newRowData]);
      const results = await connectionManager.executeQuery(insertQuery);
      insertIDs = { [params.dataType]: results.insertId }; // Standardize output with table name as key
      // special handling needed for quadrats --> need to correlate incoming quadrats with current census
      if (params.dataType === 'quadrats' && censusID) {
        const cqQuery = format('INSERT INTO ?? SET ?', [`${schema}.censusquadrats`, { CensusID: censusID, QuadratID: insertIDs.quadrats }]);
        const results = await connectionManager.executeQuery(cqQuery);
        if (results.length === 0) throw new Error('Error inserting to censusquadrats');
      }
    }
    await connectionManager.commitTransaction(transactionID ?? '');
    return NextResponse.json({ message: 'Insert successful', createdIDs: insertIDs }, { status: HTTPResponses.OK });
  } catch (error: any) {
    return handleError(error, connectionManager, newRow, transactionID ?? undefined);
  } finally {
    await connectionManager.closeConnection();
  }
}

// slugs: schema, gridID
// body: full data row, only need first item from it this time though
export async function DELETE(request: NextRequest, props: { params: Promise<{ dataType: string; slugs?: string[] }> }) {
  const params = await props.params;
  if (!params.slugs) throw new Error('slugs not provided');
  const [schema, gridID] = params.slugs;
  if (!schema || !gridID) throw new Error('no schema or gridID provided');
  const connectionManager = ConnectionManager.getInstance();
  const demappedGridID = gridID.charAt(0).toUpperCase() + gridID.substring(1);
  const { newRow } = await request.json();
  let transactionID: string | undefined = undefined;
  try {
    transactionID = await connectionManager.beginTransaction();

    // Handle deletion for views
    if (['alltaxonomiesview', 'measurementssummaryview'].includes(params.dataType)) {
      const deleteRowData = MapperFactory.getMapper<any, any>(params.dataType).demapData([newRow])[0];

      // Prepare query configuration based on view
      let queryConfig;
      switch (params.dataType) {
        case 'alltaxonomiesview':
          queryConfig = AllTaxonomiesViewQueryConfig;
          break;
        default:
          throw new Error('Incorrect view call');
      }

      // Use handleDeleteForSlices for handling deletion, taking foreign key constraints into account
      await handleDeleteForSlices(connectionManager, schema, deleteRowData, queryConfig);
      return NextResponse.json({ message: 'Delete successful' }, { status: HTTPResponses.OK });
    }

    // Handle deletion for tables
    const deleteRowData = MapperFactory.getMapper<any, any>(params.dataType).demapData([newRow])[0];
    const { [demappedGridID]: gridIDKey } = deleteRowData;
    // for quadrats, censusquadrat needs to be cleared before quadrat can be deleted
    if (params.dataType === 'quadrats') {
      const qDeleteQuery = format(`DELETE FROM ?? WHERE ?? = ?`, [`${schema}.censusquadrat`, demappedGridID, gridIDKey]);
      await connectionManager.executeQuery(qDeleteQuery);
    } else if (params.dataType === 'measurementssummary') {
      // start with surrounding data
      await connectionManager.executeQuery(`DELETE FROM ${schema}.cmverrors WHERE ${demappedGridID} = ${gridIDKey}`);
      await connectionManager.executeQuery(`DELETE FROM ${schema}.cmattributes WHERE ${demappedGridID} = ${gridIDKey}`);
      // finally, perform core deletion
      await connectionManager.executeQuery(`DELETE FROM ${schema}.coremeasurements WHERE ${demappedGridID} = ${gridIDKey}`);
    } else {
      const deleteQuery = format(`DELETE FROM ?? WHERE ?? = ?`, [`${schema}.${params.dataType}`, demappedGridID, gridIDKey]);
      await connectionManager.executeQuery(deleteQuery);
    }
    await connectionManager.commitTransaction(transactionID ?? '');
    return NextResponse.json({ message: 'Delete successful' }, { status: HTTPResponses.OK });
  } catch (error: any) {
    if (error.code === 'ER_ROW_IS_REFERENCED_2') {
      await connectionManager.rollbackTransaction(transactionID ?? '');
      const referencingTableMatch = error.message.match(/CONSTRAINT `(.*?)` FOREIGN KEY \(`(.*?)`\) REFERENCES `(.*?)`/);
      const referencingTable = referencingTableMatch ? referencingTableMatch[3] : 'unknown';
      return NextResponse.json(
        {
          message: 'Foreign key conflict detected',
          referencingTable
        },
        { status: HTTPResponses.FOREIGN_KEY_CONFLICT }
      );
    } else return handleError(error, connectionManager, newRow);
  } finally {
    await connectionManager.closeConnection();
  }
}
