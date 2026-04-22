import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { AllTaxonomiesViewQueryConfig, handleUpsertForSlices } from '@/components/processors/processorhelperfunctions';
import MapperFactory from '@/config/datamapper';
import { handleUpsert } from '@/config/utils';
import { format } from 'mysql2/promise';
import { HTTPResponses } from '@/config/macros';
import { handleError } from '@/utils/errorhandler';
import { FamilyResult, GenusResult, SpeciesResult } from '@/config/sqlrdsdefinitions/taxonomies';
import { getCookie } from '@/app/actions/cookiemanager';
import { insertIngestionFailureRows } from '@/config/measurementerrors';
import { applyEdit } from '@/config/editplan/apply';
import { EditPlanDataType } from '@/config/editplan/types';
import { canonicalizeEditPayload, EDITABLE_FIELDS_BY_SURFACE, FIELD_ALIASES_BY_SURFACE } from '@/config/editplan/fieldpolicy';
import { auth } from '@/auth';

// Mapping from dataType to primary key column name
const PRIMARY_KEY_MAP: Record<string, string> = {
  failedmeasurements: 'FailedMeasurementID',
  coremeasurements: 'CoreMeasurementID',
  attributes: 'Code',
  census: 'CensusID',
  cmattributes: 'CMAID',
  family: 'FamilyID',
  genus: 'GenusID',
  personnel: 'PersonnelID',
  plots: 'PlotID',
  quadrats: 'QuadratID',
  species: 'SpeciesID',
  stems: 'StemGUID',
  trees: 'TreeID',
  rolemapping: 'RoleMappingID',
  roles: 'RoleID',
  sites: 'SiteID'
};

function parsePositiveInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function filterNewRowToSurface(dataType: EditPlanDataType, rawNewRow: Record<string, unknown>): Record<string, unknown> {
  const allowed = EDITABLE_FIELDS_BY_SURFACE[dataType];
  const aliases = FIELD_ALIASES_BY_SURFACE[dataType];
  const remapped: Record<string, unknown> = {};
  for (const [rawKey, value] of Object.entries(rawNewRow)) {
    const canonical = aliases[rawKey] ?? rawKey;
    if (allowed.has(canonical)) remapped[canonical] = value;
  }
  return canonicalizeEditPayload(dataType, remapped);
}

async function resolvePlotIDForMeasurement(
  cm: ConnectionManager,
  schema: string,
  dataType: EditPlanDataType,
  targetID: number
): Promise<number | null> {
  const cookiePlotID = parsePositiveInteger(await getCookie('plotID'));
  if (cookiePlotID !== null) return cookiePlotID;

  // Both surfaces live in coremeasurements (failedmeasurements rows have
  // StemGUID IS NULL) so we resolve the owning plot via the census row.
  const lookupSQL =
    dataType === 'measurementssummary'
      ? `SELECT c.PlotID AS PlotID FROM ${schema}.coremeasurements cm JOIN ${schema}.census c ON c.CensusID = cm.CensusID WHERE cm.CoreMeasurementID = ? LIMIT 1`
      : `SELECT c.PlotID AS PlotID FROM ${schema}.coremeasurements cm JOIN ${schema}.census c ON c.CensusID = cm.CensusID WHERE cm.CoreMeasurementID = ? AND cm.StemGUID IS NULL LIMIT 1`;

  const rows = await cm.executeQuery(lookupSQL, [targetID]);
  return parsePositiveInteger(rows?.[0]?.PlotID);
}

async function runMeasurementEditShim(
  cm: ConnectionManager,
  schema: string,
  dataType: EditPlanDataType,
  targetID: number,
  rawNewRow: Record<string, unknown>
): Promise<NextResponse> {
  const censusID = parsePositiveInteger(await getCookie('censusID'));
  if (censusID === null) throw new Error('Census context required for measurement edit');

  const plotID = await resolvePlotIDForMeasurement(cm, schema, dataType, targetID);
  if (plotID === null) throw new Error('Unable to resolve plot context for measurement edit');

  const filteredNewRow = filterNewRowToSurface(dataType, rawNewRow);

  const session = await auth().catch(() => null);
  const createdBy = session?.user?.email ?? session?.user?.name ?? 'legacy-patch-shim';

  const result = await applyEdit(cm, {
    dataType,
    schema,
    plotID,
    censusID,
    targetID,
    newRow: filteredNewRow,
    expectedPlanHash: null,
    operationType: 'single-row-edit',
    createdBy
  });

  const writerIDKey = Object.keys(result.updatedIDs)[0];
  const writerID = writerIDKey ? result.updatedIDs[writerIDKey] : targetID;

  return NextResponse.json({ message: 'Update successful', updatedIDs: { [dataType]: writerID } }, { status: HTTPResponses.OK });
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ dataType: string; slugs?: string[] }> }) {
  const { dataType, slugs } = await props.params;
  const [schema, gridID] = slugs ?? [];
  if (!schema || !gridID) throw new Error('no schema or gridID provided');

  const connectionManager = ConnectionManager.getInstance();
  // Get the primary key column name for this dataType, or fallback to capitalized gridID
  const primaryKeyColumn = PRIMARY_KEY_MAP[dataType] || gridID.charAt(0).toUpperCase() + gridID.substring(1);
  const demappedGridID = primaryKeyColumn;
  const { newRow, oldRow } = await request.json();
  let updateIDs: Record<string, number> = {};
  let transactionID: string | undefined = undefined;

  // Legacy compatibility shim: route measurement edits through the new writer
  // so the single-row edit path is unified. The public /api/edits/apply
  // endpoint requires a plan hash; this shim is the only caller allowed to
  // bypass the hash check (expectedPlanHash: null) because legacy grid
  // clients never compute one.
  if (dataType === 'measurementssummary' || dataType === 'failedmeasurements') {
    try {
      const targetID = Number(gridID);
      if (!Number.isInteger(targetID) || targetID <= 0) throw new Error('invalid targetID in slugs');
      return await runMeasurementEditShim(connectionManager, schema, dataType, targetID, newRow ?? {});
    } catch (error: any) {
      return handleError(error, connectionManager, newRow);
    } finally {
      await connectionManager.closeConnection();
    }
  }

  try {
    transactionID = await connectionManager.beginTransaction();

    if (dataType === 'alltaxonomiesview') {
      let queryConfig;
      switch (dataType) {
        case 'alltaxonomiesview':
          queryConfig = AllTaxonomiesViewQueryConfig;
          break;
        default:
          throw new Error('Incorrect view call');
      }

      updateIDs = await handleUpsertForSlices(connectionManager, schema, { ...oldRow, ...newRow }, queryConfig);
    } else {
      const mapper = MapperFactory.getMapper<any, any>(dataType);
      const oldRowData = mapper.demapData([oldRow])[0];
      const newRowData = mapper.demapData([{ ...oldRow, ...newRow }])[0];
      const previousGridIDKey = oldRowData?.[demappedGridID];
      const { [demappedGridID]: updatedGridIDKey, ...remainingProperties } = newRowData;

      let dataToUpdate;
      const censusID = parseInt((await getCookie('censusID')) ?? '0');

      if (dataType === 'plots') {
        const { NumQuadrats, ...plotTrimmed } = newRowData;
        dataToUpdate = plotTrimmed;
      } else if (dataType === 'attributes') {
        dataToUpdate = {
          [demappedGridID]: updatedGridIDKey,
          ...remainingProperties
        };
      } else if (['quadrats', 'species'].includes(dataType)) {
        const { CensusID, ...specTrimmed } = newRowData;
        dataToUpdate = specTrimmed;
      } else if (dataType === 'personnel') {
        const { CensusActive, ...personnelTrimmed } = newRowData;
        const hasCensusActiveFlag =
          Object.prototype.hasOwnProperty.call(oldRowData ?? {}, 'CensusActive') || Object.prototype.hasOwnProperty.call(newRowData, 'CensusActive');
        if (hasCensusActiveFlag) {
          if (!Number.isInteger(censusID) || censusID <= 0) {
            throw new Error('Census context required to update personnel census activity');
          }
          const query = CensusActive
            ? `INSERT IGNORE INTO ${schema}.censusactivepersonnel (CensusID, PersonnelID) VALUES (?, ?);`
            : `DELETE FROM ${schema}.censusactivepersonnel WHERE CensusID = ? AND PersonnelID = ?`;
          await connectionManager.executeQuery(query, [censusID, previousGridIDKey]);
        }
        dataToUpdate = personnelTrimmed;
      } else dataToUpdate = remainingProperties;

      const updateQuery = format(`UPDATE ?? SET ? WHERE ?? = ?`, [`${schema}.${dataType}`, dataToUpdate, demappedGridID, previousGridIDKey]);
      await connectionManager.executeQuery(`SET @CURRENT_CENSUS_ID = ?`, [censusID]);
      await connectionManager.executeQuery(updateQuery);

      updateIDs = { [dataType]: updatedGridIDKey };
    }
    await connectionManager.commitTransaction(transactionID ?? '');
    return NextResponse.json({ message: 'Update successful', updatedIDs: updateIDs }, { status: HTTPResponses.OK });
  } catch (error: any) {
    return handleError(error, connectionManager, newRow, transactionID ?? undefined);
  } finally {
    await connectionManager.closeConnection();
  }
}

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

    if (params.dataType === 'alltaxonomiesview') {
      const { Family } = newRowData;
      const { Genus, GenusAuthority } = newRowData;
      const { SpeciesCode, SpeciesName, SubspeciesName, IDLevel, SpeciesAuthority, SubspeciesAuthority, ValidCode, FieldFamily, Description } = newRowData;

      const { id: newFamilyID } = await handleUpsert<FamilyResult>(connectionManager, schema, 'family', { Family }, 'FamilyID', transactionID);

      const { id: newGenusID } = await handleUpsert<GenusResult>(
        connectionManager,
        schema,
        'genus',
        {
          Genus,
          GenusAuthority,
          FamilyID: newFamilyID
        },
        'GenusID',
        transactionID
      );

      await handleUpsert<SpeciesResult>(
        connectionManager,
        schema,
        'species',
        {
          GenusID: newGenusID,
          SpeciesCode,
          SpeciesName,
          SubspeciesName,
          IDLevel,
          SpeciesAuthority,
          SubspeciesAuthority,
          ValidCode,
          FieldFamily,
          Description
        },
        'SpeciesID',
        transactionID
      );
    } else if (['attributes', 'quadrats', 'personnel', 'species'].includes(params.dataType)) {
      if (params.dataType === 'attributes') {
        await connectionManager.executeQuery(format(`INSERT INTO ?? SET ?`, [`${schema}.${params.dataType}`, newRowData]));
      } else if (params.dataType === 'personnel') {
        await connectionManager.executeQuery(`INSERT IGNORE INTO ${schema}.censusactivepersonnel (CensusID, PersonnelID) VALUES (?, ?)`, [
          censusID ?? 0,
          newRowData.PersonnelID
        ]);
      } else {
        const { [demappedGridID]: demappedIDValue, ...remaining } = newRowData;
        const insertQuery = format(`INSERT INTO ?? SET ?`, [`${schema}.${params.dataType}`, remaining]);
        await connectionManager.executeQuery(insertQuery);
      }
    } else {
      delete newRowData[demappedGridID];
      if (params.dataType === 'plots') delete newRowData.NumQuadrats;
      if (params.dataType === 'personnel') delete newRowData.CensusActive;

      let insertQuery = '';
      if (params.dataType === 'failedmeasurements') {
        const inserted = await insertIngestionFailureRows(
          connectionManager,
          schema,
          [
            {
              plotID: Number(newRowData.PlotID ?? 0),
              censusID: Number(newRowData.CensusID ?? censusID ?? 0),
              tag: newRowData.Tag ?? null,
              stemTag: newRowData.StemTag ?? null,
              spCode: newRowData.SpCode ?? null,
              quadrat: newRowData.Quadrat ?? null,
              x: newRowData.X ?? null,
              y: newRowData.Y ?? null,
              dbh: newRowData.DBH ?? null,
              hom: newRowData.HOM ?? null,
              date: newRowData.Date ?? null,
              codes: newRowData.Codes ?? null,
              comments: newRowData.Comments ?? null,
              failureReason: newRowData.FailureReasons ?? null,
              fileID: newRowData.FileID ?? null,
              batchID: newRowData.BatchID ?? null,
              sourceRowIndex: newRowData.SourceRowIndex ?? null
            }
          ],
          transactionID
        );
        insertIDs = { [params.dataType]: inserted[0] ?? 0 };
      } else {
        insertQuery = format('INSERT INTO ?? SET ?', [`${schema}.${params.dataType}`, newRowData]);
        const results = await connectionManager.executeQuery(insertQuery);
        insertIDs = { [params.dataType]: results.insertId };
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

export async function DELETE(request: NextRequest, props: { params: Promise<{ dataType: string; slugs?: string[] }> }) {
  const params = await props.params;
  if (!params.slugs) throw new Error('slugs not provided');
  const [schema, gridID] = params.slugs;
  if (!schema || !gridID) throw new Error('no schema or gridID provided');
  const connectionManager = ConnectionManager.getInstance();
  // Get the primary key column name for this dataType, or fallback to capitalized gridID
  const primaryKeyColumn = PRIMARY_KEY_MAP[params.dataType] || gridID.charAt(0).toUpperCase() + gridID.substring(1);
  const demappedGridID = primaryKeyColumn;
  const { newRow } = await request.json();
  let transactionID: string | undefined = undefined;
  try {
    transactionID = await connectionManager.beginTransaction();

    const deleteRowData = MapperFactory.getMapper<any, any>(params.dataType).demapData([newRow])[0];
    const { [demappedGridID]: gridIDKey } = deleteRowData;
    if (params.dataType === 'alltaxonomiesview') {
      const { SpeciesID } = deleteRowData;
      await connectionManager.executeQuery(`DELETE FROM ${schema}.species WHERE SpeciesID = ?`, [SpeciesID]);
    } else if (params.dataType === 'failedmeasurements') {
      const deleteFailedQuery = format('DELETE FROM ??.coremeasurements WHERE CoreMeasurementID = ? AND StemGUID IS NULL', [schema]);
      await connectionManager.executeQuery(deleteFailedQuery, [gridIDKey]);
    } else if (params.dataType === 'measurementssummary') {
      await connectionManager.executeQuery(format('DELETE FROM ?? WHERE MeasurementID = ?', [`${schema}.measurement_error_log`]), [gridIDKey]);
      await connectionManager.executeQuery(format('DELETE FROM ?? WHERE ?? = ?', [`${schema}.cmattributes`, demappedGridID, gridIDKey]));
      await connectionManager.executeQuery(format('DELETE FROM ?? WHERE ?? = ?', [`${schema}.coremeasurements`, demappedGridID, gridIDKey]));
    } else {
      const softDelete = format(`DELETE FROM ?? WHERE ?? = ?`, [`${schema}.${params.dataType}`, demappedGridID, gridIDKey]);
      await connectionManager.executeQuery(softDelete);
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
