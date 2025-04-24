// connectionlogger.ts
import { cookies } from 'next/headers';

interface TableConfig {
  pk: string;
  fk?: string;
}

export function patchConnectionManager(cm: any) {
  const tableConfigs: Record<string, TableConfig> = {
    coremeasurements: { pk: 'CoreMeasurementID' },
    cmattributes: { pk: 'CMAID', fk: 'CoreMeasurementID' },
    cmverrors: { pk: 'CMVErrorID', fk: 'CoreMeasurementID' },
    stems: { pk: 'StemID' },
    trees: { pk: 'TreeID' },
    quadrats: { pk: 'QuadratID' },
    failedmeasurements: { pk: 'FailedMeasurementID' },
    personnel: { pk: 'PersonnelID' },
    species: { pk: 'SpeciesID' },
    genus: { pk: 'GenusID' },
    family: { pk: 'FamilyID' },
    attributes: { pk: 'Code' }
  };

  const orig = cm.executeQuery.bind(cm);

  cm.executeQuery = async function (sql: string, params?: any[], transactionId?: string) {
    const store = await cookies();
    if (!store.has('user') || !store.has('schema') || !store.has('plotID') || !store.has('censusID')) {
      return orig(sql, params, transactionId); // don't log anything
    }
    const user = String(store.get('user')?.value);
    const schema = String(store.get('schema')?.value);
    const plotID = Number(store.get('plotID')?.value);
    const censusID = Number(store.get('censusID')?.value);
    const cleaned = sql.trim().replace(/`/g, '');
    const regexOutput = /^(UPDATE|DELETE)\s+(?:FROM\s+)?(?:\w+\.)?(\w+)/i.exec(cleaned) || [];
    const op = regexOutput?.[1]?.toUpperCase() as 'UPDATE' | 'DELETE' | undefined;
    const table = regexOutput?.[2];
    if (!op || !table || !tableConfigs[table]) return orig(sql, params, transactionId); // don't log anything
    const { pk, fk } = tableConfigs[table];

    let coreKey = pk;
    let coreValue: any = null;

    const pkRx = new RegExp(`\\b${pk}\\b\\s*=\\s*(\\?|\\d+|'[^']*'|"[^"]*")`);
    const mPk = pkRx.exec(cleaned);
    if (mPk) {
      const raw = mPk[1];
      if (raw === '?' && params) {
        const prefix = cleaned.slice(0, mPk.index);
        const idx = (prefix.match(/\?/g) || []).length;
        coreValue = params[idx];
      } else {
        coreValue = raw.replace(/^['"]|['"]$/g, '');
      }
    }

    if (coreValue == null && fk) {
      const fkRx = new RegExp(`\\b${fk}\\b\\s*=\\s*(\\?|\\d+|'[^']*'|"[^"]*")`);
      const mFk = fkRx.exec(cleaned);
      if (mFk) {
        coreKey = fk; // switch to foreign key
        const raw = mFk[1];
        if (raw === '?' && params) {
          const prefix = cleaned.slice(0, mFk.index);
          const idx = (prefix.match(/\?/g) || []).length;
          coreValue = params[idx];
        } else {
          coreValue = raw.replace(/^['"]|['"]$/g, '');
        }
      }
    }

    if (coreValue == null) {
      return orig(sql, params, transactionId);
    }
    // shifting all to bulk updating:
    const where = cleaned.toUpperCase().indexOf(' WHERE ') > 0 ? cleaned.slice(cleaned.toUpperCase().indexOf(' WHERE ')) : '';
    if (!where) return orig(sql, params, transactionId);
    const searchQuery = `SELECT * FROM \`${schema}\`.\`${table}\` ${where}`;
    const beforeImages = (await orig(searchQuery, params, transactionId)) as any[];
    const recordIDs = beforeImages.map(r => r[coreKey]);

    const result = await orig(sql, params, transactionId);

    const afterImages = (await orig(searchQuery, params, transactionId)) as any[];

    if (JSON.stringify(beforeImages) === JSON.stringify(afterImages)) {
      console.log('old state and new state are the same, not logging');
      return result; // returning result since we've already executed the orig query
    }

    await orig(
      `INSERT INTO \`${schema}\`.\`unifiedchangelog\` (TableName, RecordID, Operation, OldRowState, NewRowState, ChangedBy, PlotID, CensusID) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [table, recordIDs.join('|'), op, beforeImages, afterImages, user, plotID, censusID],
      transactionId
    );
    return result;
  };
}
