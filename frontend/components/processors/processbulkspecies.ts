import { SpecialBulkProcessingProps } from '@/config/macros';
import { buildBulkUpsertQuery } from '@/config/utils';
import { format } from 'mysql2/promise';

export async function processBulkSpecies(props: Readonly<SpecialBulkProcessingProps>): Promise<void> {
  const { connectionManager, rowDataSet, schema, census } = props;

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

  await connectionManager.executeQuery(`
  CREATE TEMPORARY TABLE IF NOT EXISTS \`${schema}\`.stagingspecies (
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
  ) ENGINE=MEMORY;
`);
  const { sql, params } = buildBulkUpsertQuery(schema, 'stagingspecies', bulkSpeciesData as any, 'id');
  await connectionManager.executeQuery(format(sql, params));

  const familySQL = `
  INSERT INTO ${schema}.family (Family) 
  SELECT DISTINCT Family FROM ${schema}.stagingspecies 
  ON DUPLICATE KEY UPDATE Family = VALUES(Family);`;
  const genusSQL = `
  INSERT INTO ${schema}.genus (Genus, FamilyID)
  SELECT DISTINCT stsp.Genus, f.FamilyID FROM ${schema}.stagingspecies stsp 
  JOIN ${schema}.family f ON stsp.Family = f.Family
  ON DUPLICATE KEY UPDATE FamilyID = VALUES(FamilyID);`;
  const speciesSQL = `
  INSERT INTO ${schema}.species (SpeciesCode, SpeciesName, SubspeciesName, IDLevel, SpeciesAuthority, SubspeciesAuthority, GenusID)
  SELECT DISTINCT 
  nullif(i.SpeciesCode, ''), 
  nullif(i.SpeciesName, ''), 
  nullif(i.SubspeciesName, ''), 
  nullif(i.IDLevel, ''), 
  nullif(i.SpeciesAuthority, ''), 
  nullif(i.SubspeciesAuthority, ''), 
  nullif(g.GenusID, '') 
  FROM ${schema}.stagingspecies i 
  JOIN ${schema}.genus g ON i.Genus = g.Genus
  ON DUPLICATE KEY UPDATE 
    SpeciesCode = VALUES(SpeciesCode), 
    SpeciesName = VALUES(SpeciesName), 
    SubspeciesName = VALUES(SubspeciesName), 
    IDLevel = VALUES(IDLevel), 
    SpeciesAuthority = VALUES(SpeciesAuthority), 
    SubspeciesAuthority = VALUES(SubspeciesAuthority);`;
  await connectionManager.executeQuery(familySQL);
  await connectionManager.executeQuery(genusSQL);
  await connectionManager.executeQuery(speciesSQL);
  await connectionManager.executeQuery(`DROP TEMPORARY TABLE IF EXISTS ${schema}.stagingspecies;`);
}
