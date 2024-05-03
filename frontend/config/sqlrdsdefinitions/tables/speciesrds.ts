import { GridColDef, GridValidRowModel } from '@mui/x-data-grid';
import { IDataMapper } from "../../datamapper";
import { bitToBoolean, booleanToBit } from '../../macros';
import { Templates } from '@/config/datagridhelpers';
import { NextRequest } from 'next/server';

export type SpeciesRDS = {
  id: number;
  speciesID: number;
  genusID: number | null;
  currentTaxonFlag: boolean | null;
  obsoleteTaxonFlag: boolean | null;
  speciesName: string | null;
  subspeciesName: string | null;
  speciesCode: string | null;
  idLevel: string | null;
  speciesAuthority: string | null;
  subspeciesAuthority: string | null;
  fieldFamily: string | null;
  description: string | null;
  referenceID: number | null;
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

export class SpeciesMapper implements IDataMapper<SpeciesResult, SpeciesRDS> {
  demapData(results: SpeciesRDS[]): SpeciesResult[] {
    return results.map((item) => ({
      SpeciesID: String(item.speciesID),
      GenusID: String(item.genusID),
      CurrentTaxonFlag: item.currentTaxonFlag,
      ObsoleteTaxonFlag: item.obsoleteTaxonFlag,
      SpeciesName: item.speciesName,
      SubspeciesName: item.subspeciesName,
      SpeciesCode: item.speciesCode,
      IDLevel: item.idLevel,
      SpeciesAuthority: item.speciesAuthority,
      SubspeciesAuthority: item.subspeciesAuthority,
      FieldFamily: item.fieldFamily,
      Description: item.description,
      ReferenceID: String(item.referenceID)
    }));
  }
  mapData(results: SpeciesResult[], indexOffset: number = 1): SpeciesRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      speciesID: Number(item.SpeciesID),
      genusID: Number(item.GenusID),
      currentTaxonFlag: bitToBoolean(item.CurrentTaxonFlag),
      obsoleteTaxonFlag: bitToBoolean(item.ObsoleteTaxonFlag),
      speciesName: String(item.SpeciesName),
      subspeciesName: String(item.SubspeciesName),
      speciesCode: String(item.SpeciesCode),
      idLevel: String(item.IDLevel),
      speciesAuthority: String(item.SpeciesAuthority),
      subspeciesAuthority: String(item.SubspeciesAuthority),
      fieldFamily: String(item.FieldFamily),
      description: String(item.Description),
      referenceID: Number(item.ReferenceID)
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
  { field: 'speciesID', headerName: 'SpeciesID', headerClassName: 'header', flex: 1, align: 'left', },
  { field: 'speciesCode', headerName: 'Code', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  // {field: 'genusID', headerName: 'GenusID', headerClassName: 'header', flex: 1, align: 'left',},
  { field: 'currentTaxonFlag', headerName: 'Current?', headerClassName: 'header', flex: 1, align: 'left', type: 'boolean', editable: true },
  { field: 'obsoleteTaxonFlag', headerName: 'Obsolete?', headerClassName: 'header', flex: 1, align: 'left', type: 'boolean', editable: true },
  { field: 'speciesName', headerName: 'Species', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'subSpeciesName', headerName: 'Subspecies', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'idLevel', headerName: 'IDLevel', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'speciesAuthority', headerName: 'Authority', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'subspeciesAuthority', headerName: 'Authority', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'fieldFamily', headerName: 'FieldFamily', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'description', headerName: 'Description', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  // {field: 'referenceID', headerName: 'ReferenceID', headerClassName: 'header', flex: 1, align: 'left',},
];