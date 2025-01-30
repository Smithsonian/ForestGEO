import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { escape } from 'mysql2';
import { format } from 'mysql2/promise';
import MapperFactory from '@/config/datamapper';
import { HTTPResponses } from '@/config/macros';
import { GridFilterItem, GridFilterModel } from '@mui/x-data-grid';
import { handleError } from '@/utils/errorhandler';
import { AllTaxonomiesViewQueryConfig, handleDeleteForSlices, handleUpsertForSlices } from '@/components/processors/processorhelperfunctions';

type VisibleFilter = 'valid' | 'errors' | 'pending';

interface ExtendedGridFilterModel extends GridFilterModel {
  visible: VisibleFilter[];
}

export async function POST(
  request: NextRequest,
  {
    params
  }: {
    params: { dataType: string; slugs?: string[] };
  }
) {
  // trying to ensure that system correctly retains edit/add functionality -- not necessarily needed currently but better safe than sorry
  const body = await request.json();
  if (body.newRow) {
    // required dynamic parameters: dataType (fixed),[ schema, gridID value] -> slugs
    if (!params.slugs) throw new Error('slugs not provided');
    const [schema, gridID, plotIDParam, censusIDParam] = params.slugs;
    if (!schema || !gridID) throw new Error('no schema or gridID provided');

    const plotID = plotIDParam ? parseInt(plotIDParam) : undefined;
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
        const insertQuery = format('INSERT INTO ?? SET ?', [`${schema}.${params.dataType}`, newRowData]);
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
      return handleError(error, connectionManager, newRow, transactionID);
    } finally {
      await connectionManager.closeConnection();
    }
  } else {
    const filterModel: ExtendedGridFilterModel = body.filterModel;
    if (!params.slugs || params.slugs.length < 5) throw new Error('slugs not received.');
    const [schema, pageParam, pageSizeParam, plotIDParam, plotCensusNumberParam] = params.slugs;
    if (!schema || schema === 'undefined' || !pageParam || pageParam === 'undefined' || !pageSizeParam || pageSizeParam === 'undefined')
      throw new Error('core slugs schema/page/pageSize not correctly received');
    if (!filterModel || (!filterModel.items && !filterModel.quickFilterValues)) throw new Error('filterModel is empty. filter API should not have triggered.');
    const page = parseInt(pageParam);
    const pageSize = parseInt(pageSizeParam);
    const plotID = plotIDParam ? parseInt(plotIDParam) : undefined;
    const plotCensusNumber = plotCensusNumberParam ? parseInt(plotCensusNumberParam) : undefined;
    const connectionManager = ConnectionManager.getInstance();
    let updatedMeasurementsExist = false;
    let censusIDs;
    let pastCensusIDs: string | any[];
    let transactionID: string | undefined = undefined;

    const buildFilterModelStub = (filterModel: GridFilterModel, alias?: string) => {
      if (!filterModel.items || filterModel.items.length === 0) {
        return '';
      }

      return filterModel.items
        .map((item: GridFilterItem) => {
          const { field, operator, value } = item;
          const aliasedField = `${alias ? `${alias}.` : ''}${field}`;
          const escapedValue = escape(`%${value}%`); // Handle escaping
          return `${aliasedField} ${operator} ${escapedValue}`;
        })
        .join(` ${filterModel?.logicOperator?.toUpperCase() || 'AND'} `);
    };

    const buildSearchStub = (columns: string[], quickFilter: string[], alias?: string) => {
      if (!quickFilter || quickFilter.length === 0) {
        return ''; // Return empty if no quick filters
      }

      return columns
        .map(column => {
          const aliasedColumn = `${alias ? `${alias}.` : ''}${column}`;
          return quickFilter.map(word => `${aliasedColumn} LIKE ${escape(`%${word}%`)}`).join(' OR ');
        })
        .join(' OR ');
    };

    try {
      let paginatedQuery = ``;
      const queryParams: any[] = [];
      let columns: any[] = [];
      try {
        const query = `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? 
      AND COLUMN_NAME NOT LIKE '%id%' AND COLUMN_NAME NOT LIKE '%uuid%' AND COLUMN_NAME NOT LIKE 'id%'  AND COLUMN_NAME NOT LIKE '%_id' `;
        const results = await connectionManager.executeQuery(query, [schema, params.dataType]);
        columns = results.map((row: any) => row.COLUMN_NAME);
      } catch (e: any) {
        console.error('error: ', e);
        throw new Error(e);
      }
      let searchStub = '';
      let filterStub = '';
      switch (params.dataType) {
        case 'validationprocedures':
          if (filterModel.quickFilterValues) searchStub = buildSearchStub(columns, filterModel.quickFilterValues);
          if (filterModel.items) filterStub = buildFilterModelStub(filterModel);

          paginatedQuery = `
          SELECT SQL_CALC_FOUND_ROWS * FROM catalog.${params.dataType} 
          ${searchStub || filterStub ? ` WHERE (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : ''}`; // validation procedures is special
          queryParams.push(page * pageSize, pageSize);
          break;
        case 'attributes':
        case 'species':
        case 'stems':
        case 'alltaxonomiesview':
        case 'quadratpersonnel':
        case 'sitespecificvalidations':
        case 'roles':
          if (filterModel.quickFilterValues) searchStub = buildSearchStub(columns, filterModel.quickFilterValues);
          if (filterModel.items) filterStub = buildFilterModelStub(filterModel);

          paginatedQuery = `SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.${params.dataType} 
          ${searchStub || filterStub ? ` WHERE (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : ''}`;
          queryParams.push(page * pageSize, pageSize);
          break;
        case 'personnel':
          if (filterModel.quickFilterValues) searchStub = buildSearchStub(columns, filterModel.quickFilterValues, 'p');
          if (filterModel.items) filterStub = buildFilterModelStub(filterModel, 'p');

          paginatedQuery = `
            SELECT SQL_CALC_FOUND_ROWS p.*
            FROM ${schema}.${params.dataType} p
                     JOIN ${schema}.census c ON p.CensusID = c.CensusID
            WHERE c.PlotID = ?
              AND c.PlotCensusNumber = ? 
              ${searchStub || filterStub ? ` AND (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : ''}`;
          queryParams.push(plotID, plotCensusNumber, page * pageSize, pageSize);
          break;
        case 'unifiedchangelog':
          if (filterModel.quickFilterValues) searchStub = buildSearchStub(columns, filterModel.quickFilterValues);
          if (filterModel.items) filterStub = buildFilterModelStub(filterModel);

          paginatedQuery = `
            SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.${params.dataType} uc
            JOIN ${schema}.plots p ON uc.PlotID = p.PlotID
            JOIN ${schema}.census c ON uc.CensusID = c.CensusID
            WHERE p.PlotID = ?
            AND c.PlotCensusNumber = ?
            ${searchStub || filterStub ? ` AND (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : ''}`;
          queryParams.push(plotID, plotCensusNumber, page * pageSize, pageSize);
          break;
        case 'quadrats':
          if (filterModel.quickFilterValues) searchStub = buildSearchStub(columns, filterModel.quickFilterValues, 'q');
          if (filterModel.items) filterStub = buildFilterModelStub(filterModel, 'q');

          paginatedQuery = `
            SELECT SQL_CALC_FOUND_ROWS q.*
            FROM ${schema}.quadrats q
                     JOIN ${schema}.censusquadrat cq ON q.QuadratID = cq.QuadratID
                     JOIN ${schema}.census c ON cq.CensusID = c.CensusID
            WHERE q.PlotID = ?
              AND c.PlotID = ?
              AND c.PlotCensusNumber = ? 
              ${searchStub || filterStub ? ` AND (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : ''}`;
          queryParams.push(plotID, plotID, plotCensusNumber, page * pageSize, pageSize);
          break;
        case 'personnelrole':
          if (filterModel.quickFilterValues) searchStub = buildSearchStub(columns, filterModel.quickFilterValues, 'p');
          if (filterModel.items) filterStub = buildFilterModelStub(filterModel, 'p');

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
        WHERE c.PlotID = ? 
        AND c.PlotCensusNumber = ? 
        ${searchStub || filterStub ? ` AND (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : ''}`;
          queryParams.push(plotID, plotCensusNumber, page * pageSize, pageSize);
          break;
        case 'census':
          if (filterModel.quickFilterValues) searchStub = buildSearchStub(columns, filterModel.quickFilterValues);
          if (filterModel.items) filterStub = buildFilterModelStub(filterModel);

          paginatedQuery = `
            SELECT SQL_CALC_FOUND_ROWS *
            FROM ${schema}.census
            WHERE PlotID = ? 
            ${searchStub || filterStub ? ` AND (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : ''}`;
          queryParams.push(plotID, page * pageSize, pageSize);
          break;
        case 'measurementssummary':
        case 'measurementssummary_staging':
        case 'measurementssummaryview':
        case 'viewfulltable':
        case 'viewfulltableview':
          if (filterModel.quickFilterValues) searchStub = buildSearchStub(columns, filterModel.quickFilterValues, 'vft');
          if (filterModel.items) filterStub = buildFilterModelStub(filterModel, 'vft');

          paginatedQuery = `
            SELECT SQL_CALC_FOUND_ROWS vft.*
            FROM ${schema}.${params.dataType} vft
                     JOIN ${schema}.census c ON vft.PlotID = c.PlotID AND vft.CensusID = c.CensusID
            WHERE vft.PlotID = ?
              AND c.PlotID = ?
              AND c.PlotCensusNumber = ?
              ${
                filterModel.visible.length > 0
                  ? ` AND (${filterModel.visible
                      .map(v => {
                        switch (v) {
                          case 'valid':
                            return `vft.IsValidated = TRUE`;
                          case 'errors':
                            return `vft.IsValidated = FALSE`;
                          case 'pending':
                            return `vft.IsValidated IS NULL`;
                          default:
                            return null;
                        }
                      })
                      .filter(Boolean)
                      .join(' OR ')})`
                  : ''
              }
              ${searchStub || filterStub ? ` AND (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : ''}
            ORDER BY vft.MeasurementDate ASC`;
          queryParams.push(plotID, plotID, plotCensusNumber, page * pageSize, pageSize);
          break;
        case 'coremeasurements':
          if (filterModel.quickFilterValues) searchStub = buildSearchStub(columns, filterModel.quickFilterValues, 'pdt');
          if (filterModel.items) filterStub = buildFilterModelStub(filterModel, 'pdt');

          const censusQuery = `
            SELECT CensusID
            FROM ${schema}.census
            WHERE PlotID = ?
              AND PlotCensusNumber = ?
            ORDER BY StartDate DESC LIMIT 30
        `;
          const censusResults = await connectionManager.executeQuery(format(censusQuery, [plotID, plotCensusNumber]));
          if (censusResults.length < 2) {
            paginatedQuery = `
              SELECT SQL_CALC_FOUND_ROWS pdt.*
              FROM ${schema}.${params.dataType} pdt
                       JOIN ${schema}.census c ON pdt.CensusID = c.CensusID
              WHERE c.PlotID = ?
                AND c.PlotCensusNumber = ? AND (${searchStub} ${filterStub !== '' ? `OR ${filterStub}` : ``})
              ORDER BY pdt.MeasurementDate`;
            queryParams.push(plotID, plotCensusNumber, page * pageSize, pageSize);
            break;
          } else {
            updatedMeasurementsExist = true;
            censusIDs = censusResults.map((c: any) => c.CensusID);
            pastCensusIDs = censusIDs.slice(1);
            paginatedQuery = `
              SELECT SQL_CALC_FOUND_ROWS pdt.*
              FROM ${schema}.${params.dataType} pdt
                       JOIN ${schema}.census c ON sp.CensusID = c.CensusID
              WHERE c.PlotID = ?
                AND c.CensusID IN (${censusIDs.map(() => '?').join(', ')}) 
                ${searchStub || filterStub ? ` AND (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : ''}
              ORDER BY pdt.MeasurementDate ASC`;
            queryParams.push(plotID, ...censusIDs, page * pageSize, pageSize);
            break;
          }
        default:
          throw new Error(`Unknown dataType: ${params.dataType}`);
      }
      paginatedQuery += ` LIMIT ?, ?;`;

      if (paginatedQuery.match(/\?/g)?.length !== queryParams.length) {
        throw new Error(
          `Mismatch between query placeholders and parameters: paginated query length: ${paginatedQuery.match(/\?/g)?.length}, parameters length: ${queryParams.length}`
        );
      }
      transactionID = await connectionManager.beginTransaction();
      const paginatedResults = await connectionManager.executeQuery(format(paginatedQuery, queryParams));
      const totalRowsQuery = 'SELECT FOUND_ROWS() as totalRows';
      const totalRowsResult = await connectionManager.executeQuery(totalRowsQuery);
      console.log('total rows: ', totalRowsResult);
      const totalRows = totalRowsResult[0].totalRows;
      await connectionManager.commitTransaction(transactionID ?? '');
      if (updatedMeasurementsExist) {
        const deprecated = paginatedResults.filter((row: any) => pastCensusIDs.includes(row.CensusID));

        const uniqueKeys = ['PlotID', 'QuadratID', 'TreeID', 'StemID'];
        const outputKeys = paginatedResults.map((row: any) => uniqueKeys.map(key => row[key]).join('|'));
        const filteredDeprecated = deprecated.filter((row: any) => outputKeys.includes(uniqueKeys.map(key => row[key]).join('|')));
        return new NextResponse(
          JSON.stringify({
            output: MapperFactory.getMapper<any, any>(params.dataType).mapData(paginatedResults),
            deprecated: MapperFactory.getMapper<any, any>(params.dataType).mapData(filteredDeprecated),
            totalCount: totalRows,
            finishedQuery: format(paginatedQuery, queryParams)
          }),
          { status: HTTPResponses.OK }
        );
      } else {
        return new NextResponse(
          JSON.stringify({
            output: MapperFactory.getMapper<any, any>(params.dataType).mapData(paginatedResults),
            deprecated: undefined,
            totalCount: totalRows,
            finishedQuery: format(paginatedQuery, queryParams)
          }),
          { status: HTTPResponses.OK }
        );
      }
    } catch (error: any) {
      await connectionManager.rollbackTransaction(transactionID ?? '');
      throw new Error(error);
    } finally {
      await connectionManager.closeConnection();
    }
  }
}

// slugs: schema, gridID
export async function PATCH(request: NextRequest, { params }: { params: { dataType: string; slugs?: string[] } }) {
  if (!params.slugs) throw new Error('slugs not provided');
  const [schema, gridID] = params.slugs;
  if (!schema || !gridID) throw new Error('no schema or gridID provided');

  const connectionManager = ConnectionManager.getInstance();
  const demappedGridID = gridID.charAt(0).toUpperCase() + gridID.substring(1);
  const { newRow } = await request.json();
  let updateIDs: Record<string, number> = {};
  let transactionID: string | undefined = undefined;

  try {
    transactionID = await connectionManager.beginTransaction();

    // Handle views with handleUpsertForSlices (applies to both insert and update logic)
    if (params.dataType === 'alltaxonomiesview') {
      let queryConfig;
      switch (params.dataType) {
        case 'alltaxonomiesview':
          queryConfig = AllTaxonomiesViewQueryConfig;
          break;
        default:
          throw new Error('Incorrect view call');
      }

      // Use handleUpsertForSlices for update operations as well (updates where needed)
      updateIDs = await handleUpsertForSlices(connectionManager, schema, newRow, queryConfig);
    }

    // Handle non-view table updates
    else {
      const newRowData = MapperFactory.getMapper<any, any>(params.dataType).demapData([newRow])[0];
      const { [demappedGridID]: gridIDKey, ...remainingProperties } = newRowData;

      // Construct the UPDATE query
      const updateQuery = format(
        `UPDATE ??
         SET ?
         WHERE ?? = ?`,
        [`${schema}.${params.dataType}`, remainingProperties, demappedGridID, gridIDKey]
      );

      // Execute the UPDATE query
      await connectionManager.executeQuery(updateQuery);

      // For non-view tables, standardize the response format
      updateIDs = { [params.dataType]: gridIDKey };
    }

    await connectionManager.commitTransaction(transactionID ?? '');
    return NextResponse.json({ message: 'Update successful', updatedIDs: updateIDs }, { status: HTTPResponses.OK });
  } catch (error: any) {
    return handleError(error, connectionManager, newRow, transactionID);
  } finally {
    await connectionManager.closeConnection();
  }
}

// slugs: schema, gridID
// body: full data row, only need first item from it this time though
export async function DELETE(request: NextRequest, { params }: { params: { dataType: string; slugs?: string[] } }) {
  if (!params.slugs) throw new Error('slugs not provided');
  const [schema, gridID] = params.slugs;
  if (!schema || !gridID) throw new Error('no schema or gridID provided');
  let transactionID: string | undefined = undefined;
  const connectionManager = ConnectionManager.getInstance();
  const demappedGridID = gridID.charAt(0).toUpperCase() + gridID.substring(1);
  const { newRow } = await request.json();
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
      await connectionManager.commitTransaction(transactionID ?? '');
      return NextResponse.json({ message: 'Delete successful' }, { status: HTTPResponses.OK });
    }

    // Handle deletion for tables
    const deleteRowData = MapperFactory.getMapper<any, any>(params.dataType).demapData([newRow])[0];
    const { [demappedGridID]: gridIDKey } = deleteRowData;
    // for quadrats, censusquadrat needs to be cleared before quadrat can be deleted
    if (params.dataType === 'quadrats') {
      const qDeleteQuery = format(`DELETE FROM ?? WHERE ?? = ?`, [`${schema}.censusquadrat`, demappedGridID, gridIDKey]);
      await connectionManager.executeQuery(qDeleteQuery);
    }
    const deleteQuery = format(`DELETE FROM ?? WHERE ?? = ?`, [`${schema}.${params.dataType}`, demappedGridID, gridIDKey]);
    await connectionManager.executeQuery(deleteQuery);
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
    } else return handleError(error, connectionManager, newRow, transactionID);
  } finally {
    await connectionManager.closeConnection();
  }
}
