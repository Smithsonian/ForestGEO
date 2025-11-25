import { SpecialBulkProcessingProps } from '@/config/macros';
import { buildBulkUpsertQuery } from '@/config/utils';
import { format } from 'mysql2/promise';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';

export async function processBulkSpecies(props: Readonly<SpecialBulkProcessingProps>): Promise<void> {
  const { connectionManager, rowDataSet, schema, census: _census } = props;

  const bulkSpeciesData = Object.values(rowDataSet).map(row => ({
    Family: row.family ?? '',
    Genus: row.genus ?? '',
    SpeciesCode: row.spcode ?? '',
    SpeciesName: row.species ?? '',
    SubspeciesName: row.subspecies ?? '',
    IDLevel: row.idlevel ?? '',
    SpeciesAuthority: row.authority ?? '',
    SubspeciesAuthority: row.subauthority ?? ''
  }));

  await connectionManager.executeQuery(
    safeFormatQuery(
      schema,
      `CREATE TEMPORARY TABLE IF NOT EXISTS ??.stagingspecies (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    Family              VARCHAR(255) not null default '',
    Genus               VARCHAR(255) not null default '',
    SpeciesCode         VARCHAR(255) not null default '',
    SpeciesName         VARCHAR(255) not null default '',
    SubspeciesName      VARCHAR(255) not null default '',
    IDLevel             VARCHAR(255) not null default '',
    SpeciesAuthority    VARCHAR(255) not null default '',
    SubspeciesAuthority VARCHAR(255) not null default '',
    UNIQUE KEY stsp_unique (
    Family(40),
    Genus(40),
    SpeciesCode(40),
    SpeciesName(40),
    SubspeciesName(40),
    IDLevel(20),
    SpeciesAuthority(40),
    SubspeciesAuthority(40))
  ) ENGINE=MEMORY;`
    )
  );
  const { sql, params } = buildBulkUpsertQuery(schema, 'stagingspecies', bulkSpeciesData as any, 'id');
  await connectionManager.executeQuery(format(sql, params));

  const familySQL = safeFormatQuery(
    schema,
    `INSERT INTO ??.family (Family)
  SELECT DISTINCT Family FROM ??.stagingspecies
  ON DUPLICATE KEY UPDATE Family = VALUES(Family);`
  );
  const genusSQL = safeFormatQuery(
    schema,
    `INSERT INTO ??.genus (Genus, FamilyID)
  SELECT DISTINCT stsp.Genus, f.FamilyID FROM ??.stagingspecies stsp
  JOIN ??.family f ON stsp.Family = f.Family
  ON DUPLICATE KEY UPDATE FamilyID = VALUES(FamilyID);`
  );
  const speciesSQL = safeFormatQuery(
    schema,
    `INSERT INTO ??.species (SpeciesCode, SpeciesName, SubspeciesName, IDLevel, SpeciesAuthority, SubspeciesAuthority, GenusID)
  SELECT DISTINCT
  nullif(i.SpeciesCode, ''),
  nullif(i.SpeciesName, ''),
  nullif(i.SubspeciesName, ''),
  nullif(i.IDLevel, ''),
  nullif(i.SpeciesAuthority, ''),
  nullif(i.SubspeciesAuthority, ''),
  g.GenusID
  FROM ??.stagingspecies i
  JOIN ??.genus g ON i.Genus = g.Genus
  ON DUPLICATE KEY UPDATE
    SpeciesCode = VALUES(SpeciesCode),
    SpeciesName = VALUES(SpeciesName),
    SubspeciesName = VALUES(SubspeciesName),
    IDLevel = VALUES(IDLevel),
    SpeciesAuthority = VALUES(SpeciesAuthority),
    SubspeciesAuthority = VALUES(SubspeciesAuthority);`
  );
  await connectionManager.executeQuery(familySQL);
  await connectionManager.executeQuery(genusSQL);
  await connectionManager.executeQuery(speciesSQL);
  await connectionManager.executeQuery(safeFormatQuery(schema, `DROP TEMPORARY TABLE IF EXISTS ??.stagingspecies;`));
}
