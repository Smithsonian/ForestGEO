import { GridColDef, GridValidRowModel } from '@mui/x-data-grid';
import { IDataMapper } from "../../datamapper";
import { bitToBoolean, booleanToBit } from '../../macros';
import { Templates } from '@/config/datagridhelpers';
import { NextRequest } from 'next/server';
import { ValidationFunction, RowValidationErrors } from '@/config/macros/formdetails';

export type SpeciesRDS = {
  id?: number;
  speciesID?: number;
  genusID?: number;
  currentTaxonFlag?: boolean;
  obsoleteTaxonFlag?: boolean;
  speciesName?: string;
  subspeciesName?: string;
  speciesCode?: string;
  idLevel?: string;
  speciesAuthority?: string;
  subspeciesAuthority?: string;
  fieldFamily?: string;
  description?: string;
  referenceID?: number;
};

export interface SpeciesResult {
  SpeciesID: any;
  GenusID: any;
  CurrentTaxonFlag: any;
  ObsoleteTaxonFlag: any;
  SpeciesName: any;
  SubspeciesName: any;
  SpeciesCode: any;
  IDLevel: any;
  SpeciesAuthority: any;
  SubspeciesAuthority: any;
  FieldFamily: any;
  Description: any;
  ReferenceID: any;
}

const SPECIES_SPECIESCODE_LIMIT = 25;
const SPECIES_SPECIESNAME_LIMIT = 64;
const SPECIES_SUBSPECIESNAME_LIMIT = 255;
const SPECIES_IDLEVEL_LIMIT = 20;
const SPECIES_SPECIESAUTHORITY_LIMIT = 128;
const SPECIES_SUBSPECIESAUTHORITY_LIMIT = 255;
const GENUS_GENUS_LIMIT = 32;
const FAMILY_FAMILY_LIMIT = 32;
export const validateSpeciesFormRow: ValidationFunction = (row) => {
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

export class SpeciesMapper implements IDataMapper<SpeciesResult, SpeciesRDS> {
  mapData(results: SpeciesResult[], indexOffset: number = 1): SpeciesRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      speciesID: item.SpeciesID != null ? Number(item.SpeciesID) : undefined,
      genusID: item.GenusID != null ? Number(item.GenusID) : undefined,
      currentTaxonFlag: item.CurrentTaxonFlag != null ? bitToBoolean(item.CurrentTaxonFlag) : undefined,
      obsoleteTaxonFlag: item.ObsoleteTaxonFlag != null ? bitToBoolean(item.ObsoleteTaxonFlag) : undefined,
      speciesName: item.SpeciesName != null ? String(item.SpeciesName) : undefined,
      subspeciesName: item.SubspeciesName != null ? String(item.SubspeciesName) : undefined,
      speciesCode: item.SpeciesCode != null ? String(item.SpeciesCode) : undefined,
      idLevel: item.IDLevel != null ? String(item.IDLevel) : undefined,
      speciesAuthority: item.SpeciesAuthority != null ? String(item.SpeciesAuthority) : undefined,
      subspeciesAuthority: item.SubspeciesAuthority != null ? String(item.SubspeciesAuthority) : undefined,
      fieldFamily: item.FieldFamily != null ? String(item.FieldFamily) : undefined,
      description: item.Description != null ? String(item.Description) : undefined,
      referenceID: item.ReferenceID != null ? Number(item.ReferenceID) : undefined,
    }));
  }

  demapData(results: SpeciesRDS[]): SpeciesResult[] {
    return results.map((item) => ({
      SpeciesID: item.speciesID != null ? Number(item.speciesID) : null,
      GenusID: item.genusID != null ? Number(item.genusID) : null,
      CurrentTaxonFlag: item.currentTaxonFlag != null ? item.currentTaxonFlag : null,
      ObsoleteTaxonFlag: item.obsoleteTaxonFlag != null ? item.obsoleteTaxonFlag : null,
      SpeciesName: item.speciesName != null ? String(item.speciesName) : null,
      SubspeciesName: item.subspeciesName != null ? String(item.subspeciesName) : null,
      SpeciesCode: item.speciesCode != null ? String(item.speciesCode) : null,
      IDLevel: item.idLevel != null ? String(item.idLevel) : null,
      SpeciesAuthority: item.speciesAuthority != null ? String(item.speciesAuthority) : null,
      SubspeciesAuthority: item.subspeciesAuthority != null ? String(item.subspeciesAuthority) : null,
      FieldFamily: item.fieldFamily != null ? String(item.fieldFamily) : null,
      Description: item.description != null ? String(item.description) : null,
      ReferenceID: item.referenceID != null ? Number(item.referenceID) : null,
    }));
  }
}

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
  'referenceID'
];


export const SpeciesGridColumns: GridColDef[] = [
  // { field: 'id', headerName: '#', headerClassName: 'header', flex: 1, align: 'left', maxWidth: 50},
  { field: 'speciesCode', headerName: 'SpCode', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true,  maxWidth: 125 },
  // {field: 'genusID', headerName: 'GenusID', headerClassName: 'header', flex: 1, align: 'left',},
  // { field: 'currentTaxonFlag', headerName: 'Current?', headerClassName: 'header', flex: 1, align: 'left', type: 'boolean', editable: true },
  // { field: 'obsoleteTaxonFlag', headerName: 'Obsolete?', headerClassName: 'header', flex: 1, align: 'left', type: 'boolean', editable: true },
  { field: 'speciesName', headerName: 'Species', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'subSpeciesName', headerName: 'Subspecies', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'idLevel', headerName: 'IDLevel', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'speciesAuthority', headerName: 'SpeciesAuth', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'subspeciesAuthority', headerName: 'SubspeciesAuth', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'fieldFamily', headerName: 'FieldFamily', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'description', headerName: 'Description', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  // {field: 'referenceID', headerName: 'ReferenceID', headerClassName: 'header', flex: 1, align: 'left',},
];