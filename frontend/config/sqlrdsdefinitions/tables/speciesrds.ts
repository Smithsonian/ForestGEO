// species custom data type
import { ResultType } from '@/config/utils';
import { IDataMapper } from '../../datamapper';
import { ValidationFunction, RowValidationErrors } from '@/config/macros/formdetails';

export type SpeciesRDS = {
  id?: number;
  speciesID?: number;
  genusID?: number;
  speciesName?: string;
  subspeciesName?: string;
  speciesCode?: string;
  idLevel?: string;
  speciesAuthority?: string;
  subspeciesAuthority?: string;
  fieldFamily?: string;
  description?: string;
  validCode?: string;
  referenceID?: number;
};

export type SpeciesResult = ResultType<SpeciesRDS>;

const SPECIES_SPECIESCODE_LIMIT = 25;
const SPECIES_SPECIESNAME_LIMIT = 64;
const SPECIES_SUBSPECIESNAME_LIMIT = 255;
const SPECIES_IDLEVEL_LIMIT = 20;
const SPECIES_SPECIESAUTHORITY_LIMIT = 128;
const SPECIES_SUBSPECIESAUTHORITY_LIMIT = 255;
const GENUS_GENUS_LIMIT = 32;
const FAMILY_FAMILY_LIMIT = 32;
export const validateSpeciesFormRow: ValidationFunction = row => {
  const errors: RowValidationErrors = {};

  if (row['spcode'] && row['spcode'].length > SPECIES_SPECIESCODE_LIMIT) {
    errors['spcode'] = `Species code exceeds ${SPECIES_SPECIESCODE_LIMIT} characters.`;
  }
  if (row['family'] && row['family'].length > FAMILY_FAMILY_LIMIT) {
    errors['family'] = `Family exceeds ${FAMILY_FAMILY_LIMIT} characters.`;
  }
  if (row['genus'] && row['genus'].length > GENUS_GENUS_LIMIT) {
    errors['genus'] = `Genus exceeds ${GENUS_GENUS_LIMIT} characters.`;
  }
  if (row['species'] && row['species'].length > SPECIES_SPECIESNAME_LIMIT) {
    errors['species'] = `Species exceeds ${SPECIES_SPECIESNAME_LIMIT} characters.`;
  }
  if (row['subspecies'] && row['subspecies'].length > SPECIES_SUBSPECIESNAME_LIMIT) {
    errors['subspecies'] = `Subspecies exceeds ${SPECIES_SUBSPECIESNAME_LIMIT} characters.`;
  }
  if (row['idlevel'] && row['idlevel'].length > SPECIES_IDLEVEL_LIMIT) {
    errors['idlevel'] = `ID level exceeds ${SPECIES_IDLEVEL_LIMIT} characters.`;
  }
  if (row['authority'] && row['authority'].length > SPECIES_SPECIESAUTHORITY_LIMIT) {
    errors['authority'] = `Authority exceeds ${SPECIES_SPECIESAUTHORITY_LIMIT} characters.`;
  }
  if (row['subspeciesauthority'] && row['subspeciesauthority'].length > SPECIES_SUBSPECIESAUTHORITY_LIMIT) {
    errors['subspeciesauthority'] = `Subspecies authority exceeds ${SPECIES_SUBSPECIESAUTHORITY_LIMIT} characters.`;
  }

  return Object.keys(errors).length > 0 ? errors : null;
};

export const speciesFields = [
  'currentTaxonFlag',
  'obsoleteTaxonFlag',
  'speciesName',
  'subspeciesName',
  'speciesCode',
  'idLevel',
  'speciesAuthority',
  'subspeciesAuthority',
  'fieldFamily',
  'description',
  'validCode',
  'referenceID'
];
