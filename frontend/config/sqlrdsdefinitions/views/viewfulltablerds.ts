import {IDataMapper, parseDate} from "@/config/datamapper";
import {GridColDef} from "@mui/x-data-grid";
import {bitToBoolean} from "@/config/macros";

export type ViewFullTableRDS = {
  id?: number;
  coreMeasurementID?: number;
  measurementDate?: Date;
  measuredDBH?: number;
  dbhUnit?: string;
  measuredHOM?: number;
  homUnit?: string;
  coreMeasurementDescription?: string;
  isValidated?: boolean;
  userDefinedFields?: string;
  plotID?: number;
  plotName?: string;
  locationName?: string;
  countryName?: string;
  dimensionX?: number;
  dimensionY?: number;
  plotArea?: number;
  globalX?: number;
  globalY?: number;
  globalZ?: number;
  plotUnit?: string;
  plotShape?: string;
  plotDescription?: string;
  censusID?: number;
  censusStartDate?: Date;
  censusEndDate?: Date;
  censusDescription?: string;
  plotCensusNumber?: number;
  quadratID?: number;
  quadratName?: string;
  quadratDimensionX?: number;
  quadratDimensionY?: number;
  quadratArea?: number;
  quadratShape?: string;
  quadratUnit?: string;
  subquadratID?: number;
  subquadratName?: string;
  subquadratDimensionX?: number;
  subquadratDimensionY?: number;
  x?: number;
  y?: number;
  subquadratUnit?: string;
  treeID?: number;
  treeTag?: string;
  stemID?: number;
  stemTag?: string;
  localX?: number;
  localY?: number;
  stemUnit?: string;
  personnelID?: number;
  firstName?: string;
  lastName?: string;
  personnelRoles?: string;
  quadratPersonnelID?: number;
  quadratPersonnelAssignedDate?: Date;
  quadratPersonnelRole?: string;
  speciesID?: number;
  speciesCode?: string;
  speciesName?: string;
  subspeciesName?: string;
  subspeciesAuthority?: string;
  idLevel?: string;
  speciesLimitID?: number;
  limitType?: string;
  upperBound?: number;
  lowerBound?: number;
  speciesLimitUnit?: string;
  genusID?: number;
  genus?: string;
  genusAuthority?: string;
  familyID?: number;
  family?: string;
  referenceID?: number;
  publicationTitle?: string;
  fullReference?: string;
  dateOfPublication?: Date;
  citation?: string;
  attributeCode?: string;
  attributeDescription?: string;
  attributeStatus?: string;
  cmvErrorID?: number;
  validationErrorID?: number;
  validationErrorDescription?: string;
  validationRunID?: number;
  procedureName?: string;
  runDateTime?: Date;
  targetRowID?: number;
  validationOutcome?: string;
  errorMessage?: string;
  validationCriteria?: string;
  measuredValue?: string;
  expectedValueRange?: string;
  additionalDetails?: string;
};

export interface ViewFullTableResult {
  CoreMeasurementID: any;
  MeasurementDate: any;
  MeasuredDBH: any;
  DBHUnit: any;
  MeasuredHOM: any;
  HOMUnit: any;
  CoreMeasurementDescription: any;
  IsValidated: any;
  UserDefinedFields: any;
  PlotID: any;
  PlotName: any;
  LocationName: any;
  CountryName: any;
  DimensionX: any;
  DimensionY: any;
  PlotArea: any;
  GlobalX: any;
  GlobalY: any;
  GlobalZ: any;
  PlotUnit: any;
  PlotShape: any;
  PlotDescription: any;
  CensusID: any;
  CensusStartDate: any;
  CensusEndDate: any;
  CensusDescription: any;
  PlotCensusNumber: any;
  QuadratID: any;
  QuadratName: any;
  QuadratDimensionX: any;
  QuadratDimensionY: any;
  QuadratArea: any;
  QuadratShape: any;
  QuadratUnit: any;
  SubquadratID: any;
  SubquadratName: any;
  SubquadratDimensionX: any;
  SubquadratDimensionY: any;
  X: any;
  Y: any;
  SubquadratUnit: any;
  TreeID: any;
  TreeTag: any;
  StemID: any;
  StemTag: any;
  LocalX: any;
  LocalY: any;
  StemUnit: any;
  PersonnelID: any;
  FirstName: any;
  LastName: any;
  PersonnelRoles: any;
  QuadratPersonnelID: any;
  QuadratPersonnelAssignedDate: any;
  QuadratPersonnelRole: any;
  SpeciesID: any;
  SpeciesCode: any;
  SpeciesName: any;
  SubspeciesName: any;
  SubspeciesAuthority: any;
  IDLevel: any;
  SpeciesLimitID: any;
  LimitType: any;
  UpperBound: any;
  LowerBound: any;
  SpeciesLimitUnit: any;
  GenusID: any;
  Genus: any;
  GenusAuthority: any;
  FamilyID: any;
  Family: any;
  ReferenceID: any;
  PublicationTitle: any;
  FullReference: any;
  DateOfPublication: any;
  Citation: any;
  AttributeCode: any;
  AttributeDescription: any;
  AttributeStatus: any;
  CMVErrorID: any;
  ValidationErrorID: any;
  ValidationErrorDescription: any;
  ValidationRunID: any;
  ProcedureName: any;
  RunDateTime: any;
  TargetRowID: any;
  ValidationOutcome: any;
  ErrorMessage: any;
  ValidationCriteria: any;
  MeasuredValue: any;
  ExpectedValueRange: any;
  AdditionalDetails: any;
}

export class ViewFullTableMapper implements IDataMapper<ViewFullTableResult, ViewFullTableRDS> {
  demapData(results: ViewFullTableRDS[]): ViewFullTableResult[] {
    return results.map((item) => ({
      CoreMeasurementID: item.coreMeasurementID != null ? String(item.coreMeasurementID) : null,
      MeasurementDate: item.measurementDate != null ? item.measurementDate.toISOString() : null,
      MeasuredDBH: item.measuredDBH != null ? String(item.measuredDBH) : null,
      DBHUnit: item.dbhUnit != null ? String(item.dbhUnit) : null,
      MeasuredHOM: item.measuredHOM != null ? String(item.measuredHOM) : null,
      HOMUnit: item.homUnit != null ? String(item.homUnit) : null,
      CoreMeasurementDescription: item.coreMeasurementDescription != null ? String(item.coreMeasurementDescription) : null,
      IsValidated: item.isValidated != null ? item.isValidated : null,
      UserDefinedFields: item.userDefinedFields != null ? String(item.userDefinedFields) : null,
      PlotID: item.plotID != null ? String(item.plotID) : null,
      PlotName: item.plotName != null ? String(item.plotName) : null,
      LocationName: item.locationName != null ? String(item.locationName) : null,
      CountryName: item.countryName != null ? String(item.countryName) : null,
      DimensionX: item.dimensionX != null ? String(item.dimensionX) : null,
      DimensionY: item.dimensionY != null ? String(item.dimensionY) : null,
      PlotArea: item.plotArea != null ? String(item.plotArea) : null,
      GlobalX: item.globalX != null ? String(item.globalX) : null,
      GlobalY: item.globalY != null ? String(item.globalY) : null,
      GlobalZ: item.globalZ != null ? String(item.globalZ) : null,
      PlotUnit: item.plotUnit != null ? String(item.plotUnit) : null,
      PlotShape: item.plotShape != null ? String(item.plotShape) : null,
      PlotDescription: item.plotDescription != null ? String(item.plotDescription) : null,
      CensusID: item.censusID != null ? String(item.censusID) : null,
      CensusStartDate: item.censusStartDate != null ? item.censusStartDate.toISOString() : null,
      CensusEndDate: item.censusEndDate != null ? item.censusEndDate.toISOString() : null,
      CensusDescription: item.censusDescription != null ? String(item.censusDescription) : null,
      PlotCensusNumber: item.plotCensusNumber != null ? String(item.plotCensusNumber) : null,
      QuadratID: item.quadratID != null ? String(item.quadratID) : null,
      QuadratName: item.quadratName != null ? String(item.quadratName) : null,
      QuadratDimensionX: item.quadratDimensionX != null ? String(item.quadratDimensionX) : null,
      QuadratDimensionY: item.quadratDimensionY != null ? String(item.quadratDimensionY) : null,
      QuadratArea: item.quadratArea != null ? String(item.quadratArea) : null,
      QuadratShape: item.quadratShape != null ? String(item.quadratShape) : null,
      QuadratUnit: item.quadratUnit != null ? String(item.quadratUnit) : null,
      SubquadratID: item.subquadratID != null ? String(item.subquadratID) : null,
      SubquadratName: item.subquadratName != null ? String(item.subquadratName) : null,
      SubquadratDimensionX: item.subquadratDimensionX != null ? String(item.subquadratDimensionX) : null,
      SubquadratDimensionY: item.subquadratDimensionY != null ? String(item.subquadratDimensionY) : null,
      X: item.x != null ? String(item.x) : null,
      Y: item.y != null ? String(item.y) : null,
      SubquadratUnit: item.subquadratUnit != null ? String(item.subquadratUnit) : null,
      TreeID: item.treeID != null ? String(item.treeID) : null,
      TreeTag: item.treeTag != null ? String(item.treeTag) : null,
      StemID: item.stemID != null ? String(item.stemID) : null,
      StemTag: item.stemTag != null ? String(item.stemTag) : null,
      LocalX: item.localX != null ? String(item.localX) : null,
      LocalY: item.localY != null ? String(item.localY) : null,
      StemUnit: item.stemUnit != null ? String(item.stemUnit) : null,
      PersonnelID: item.personnelID != null ? String(item.personnelID) : null,
      FirstName: item.firstName != null ? String(item.firstName) : null,
      LastName: item.lastName != null ? String(item.lastName) : null,
      PersonnelRoles: item.personnelRoles != null ? String(item.personnelRoles) : null,
      QuadratPersonnelID: item.quadratPersonnelID != null ? String(item.quadratPersonnelID) : null,
      QuadratPersonnelAssignedDate: item.quadratPersonnelAssignedDate != null ? item.quadratPersonnelAssignedDate.toISOString() : null,
      QuadratPersonnelRole: item.quadratPersonnelRole != null ? String(item.quadratPersonnelRole) : null,
      SpeciesID: item.speciesID != null ? String(item.speciesID) : null,
      SpeciesCode: item.speciesCode != null ? String(item.speciesCode) : null,
      SpeciesName: item.speciesName != null ? String(item.speciesName) : null,
      SubspeciesName: item.subspeciesName != null ? String(item.subspeciesName) : null,
      SubspeciesAuthority: item.subspeciesAuthority != null ? String(item.subspeciesAuthority) : null,
      IDLevel: item.idLevel != null ? String(item.idLevel) : null,
      SpeciesLimitID: item.speciesLimitID != null ? String(item.speciesLimitID) : null,
      LimitType: item.limitType != null ? String(item.limitType) : null,
      UpperBound: item.upperBound != null ? String(item.upperBound) : null,
      LowerBound: item.lowerBound != null ? String(item.lowerBound) : null,
      SpeciesLimitUnit: item.speciesLimitUnit != null ? String(item.speciesLimitUnit) : null,
      GenusID: item.genusID != null ? String(item.genusID) : null,
      Genus: item.genus != null ? String(item.genus) : null,
      GenusAuthority: item.genusAuthority != null ? String(item.genusAuthority) : null,
      FamilyID: item.familyID != null ? String(item.familyID) : null,
      Family: item.family != null ? String(item.family) : null,
      ReferenceID: item.referenceID != null ? String(item.referenceID) : null,
      PublicationTitle: item.publicationTitle != null ? String(item.publicationTitle) : null,
      FullReference: item.fullReference != null ? String(item.fullReference) : null,
      DateOfPublication: item.dateOfPublication != null ? item.dateOfPublication.toISOString() : null,
      Citation: item.citation != null ? String(item.citation) : null,
      AttributeCode: item.attributeCode != null ? String(item.attributeCode) : null,
      AttributeDescription: item.attributeDescription != null ? String(item.attributeDescription) : null,
      AttributeStatus: item.attributeStatus != null ? String(item.attributeStatus) : null,
      CMVErrorID: item.cmvErrorID != null ? String(item.cmvErrorID) : null,
      ValidationErrorID: item.validationErrorID != null ? String(item.validationErrorID) : null,
      ValidationErrorDescription: item.validationErrorDescription != null ? String(item.validationErrorDescription) : null,
      ValidationRunID: item.validationRunID != null ? String(item.validationRunID) : null,
      ProcedureName: item.procedureName != null ? String(item.procedureName) : null,
      RunDateTime: item.runDateTime != null ? item.runDateTime.toISOString() : null,
      TargetRowID: item.targetRowID != null ? String(item.targetRowID) : null,
      ValidationOutcome: item.validationOutcome != null ? String(item.validationOutcome) : null,
      ErrorMessage: item.errorMessage != null ? String(item.errorMessage) : null,
      ValidationCriteria: item.validationCriteria != null ? String(item.validationCriteria) : null,
      MeasuredValue: item.measuredValue != null ? String(item.measuredValue) : null,
      ExpectedValueRange: item.expectedValueRange != null ? String(item.expectedValueRange) : null,
      AdditionalDetails: item.additionalDetails != null ? String(item.additionalDetails) : null,
    }));
  }

  mapData(results: ViewFullTableResult[], indexOffset: number = 1): ViewFullTableRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      coreMeasurementID: item.CoreMeasurementID != null ? Number(item.CoreMeasurementID) : undefined,
      measurementDate: item.MeasurementDate != null ? parseDate(item.MeasurementDate) : undefined,
      measuredDBH: item.MeasuredDBH != null ? Number(item.MeasuredDBH) : undefined,
      dbhUnit: item.DBHUnit != null ? String(item.DBHUnit) : undefined,
      measuredHOM: item.MeasuredHOM != null ? Number(item.MeasuredHOM) : undefined,
      homUnit: item.HOMUnit != null ? String(item.HOMUnit) : undefined,
      coreMeasurementDescription: item.CoreMeasurementDescription != null ? String(item.CoreMeasurementDescription) : undefined,
      isValidated: item.IsValidated != null ? bitToBoolean(item.IsValidated) : undefined,
      userDefinedFields: item.UserDefinedFields != null ? String(item.UserDefinedFields) : undefined,
      plotID: item.PlotID != null ? Number(item.PlotID) : undefined,
      plotName: item.PlotName != null ? String(item.PlotName) : undefined,
      locationName: item.LocationName != null ? String(item.LocationName) : undefined,
      countryName: item.CountryName != null ? String(item.CountryName) : undefined,
      dimensionX: item.DimensionX != null ? Number(item.DimensionX) : undefined,
      dimensionY: item.DimensionY != null ? Number(item.DimensionY) : undefined,
      plotArea: item.PlotArea != null ? Number(item.PlotArea) : undefined,
      globalX: item.GlobalX != null ? Number(item.GlobalX) : undefined,
      globalY: item.GlobalY != null ? Number(item.GlobalY) : undefined,
      globalZ: item.GlobalZ != null ? Number(item.GlobalZ) : undefined,
      plotUnit: item.PlotUnit != null ? String(item.PlotUnit) : undefined,
      plotShape: item.PlotShape != null ? String(item.PlotShape) : undefined,
      plotDescription: item.PlotDescription != null ? String(item.PlotDescription) : undefined,
      censusID: item.CensusID != null ? Number(item.CensusID) : undefined,
      censusStartDate: item.CensusStartDate != null ? parseDate(item.CensusStartDate) : undefined,
      censusEndDate: item.CensusEndDate != null ? parseDate(item.CensusEndDate) : undefined,
      censusDescription: item.CensusDescription != null ? String(item.CensusDescription) : undefined,
      plotCensusNumber: item.PlotCensusNumber != null ? Number(item.PlotCensusNumber) : undefined,
      quadratID: item.QuadratID != null ? Number(item.QuadratID) : undefined,
      quadratName: item.QuadratName != null ? String(item.QuadratName) : undefined,
      quadratDimensionX: item.QuadratDimensionX != null ? Number(item.QuadratDimensionX) : undefined,
      quadratDimensionY: item.QuadratDimensionY != null ? Number(item.QuadratDimensionY) : undefined,
      quadratArea: item.QuadratArea != null ? Number(item.QuadratArea) : undefined,
      quadratShape: item.QuadratShape != null ? String(item.QuadratShape) : undefined,
      quadratUnit: item.QuadratUnit != null ? String(item.QuadratUnit) : undefined,
      subquadratID: item.SubquadratID != null ? Number(item.SubquadratID) : undefined,
      subquadratName: item.SubquadratName != null ? String(item.SubquadratName) : undefined,
      subquadratDimensionX: item.SubquadratDimensionX != null ? Number(item.SubquadratDimensionX) : undefined,
      subquadratDimensionY: item.SubquadratDimensionY != null ? Number(item.SubquadratDimensionY) : undefined,
      x: item.X != null ? Number(item.X) : undefined,
      y: item.Y != null ? Number(item.Y) : undefined,
      subquadratUnit: item.SubquadratUnit != null ? String(item.SubquadratUnit) : undefined,
      treeID: item.TreeID != null ? Number(item.TreeID) : undefined,
      treeTag: item.TreeTag != null ? String(item.TreeTag) : undefined,
      stemID: item.StemID != null ? Number(item.StemID) : undefined,
      stemTag: item.StemTag != null ? String(item.StemTag) : undefined,
      localX: item.LocalX != null ? Number(item.LocalX) : undefined,
      localY: item.LocalY != null ? Number(item.LocalY) : undefined,
      stemUnit: item.StemUnit != null ? String(item.StemUnit) : undefined,
      personnelID: item.PersonnelID != null ? Number(item.PersonnelID) : undefined,
      firstName: item.FirstName != null ? String(item.FirstName) : undefined,
      lastName: item.LastName != null ? String(item.LastName) : undefined,
      personnelRoles: item.PersonnelRoles != null ? String(item.PersonnelRoles) : undefined,
      quadratPersonnelID: item.QuadratPersonnelID != null ? Number(item.QuadratPersonnelID) : undefined,
      quadratPersonnelAssignedDate: item.QuadratPersonnelAssignedDate != null ? parseDate(item.QuadratPersonnelAssignedDate) : undefined,
      quadratPersonnelRole: item.QuadratPersonnelRole != null ? String(item.QuadratPersonnelRole) : undefined,
      speciesID: item.SpeciesID != null ? Number(item.SpeciesID) : undefined,
      speciesCode: item.SpeciesCode != null ? String(item.SpeciesCode) : undefined,
      speciesName: item.SpeciesName != null ? String(item.SpeciesName) : undefined,
      subspeciesName: item.SubspeciesName != null ? String(item.SubspeciesName) : undefined,
      subspeciesAuthority: item.SubspeciesAuthority != null ? String(item.SubspeciesAuthority) : undefined,
      idLevel: item.IDLevel != null ? String(item.IDLevel) : undefined,
      speciesLimitID: item.SpeciesLimitID != null ? Number(item.SpeciesLimitID) : undefined,
      limitType: item.LimitType != null ? String(item.LimitType) : undefined,
      upperBound: item.UpperBound != null ? Number(item.UpperBound) : undefined,
      lowerBound: item.LowerBound != null ? Number(item.LowerBound) : undefined,
      speciesLimitUnit: item.SpeciesLimitUnit != null ? String(item.SpeciesLimitUnit) : undefined,
      genusID: item.GenusID != null ? Number(item.GenusID) : undefined,
      genus: item.Genus != null ? String(item.Genus) : undefined,
      genusAuthority: item.GenusAuthority != null ? String(item.GenusAuthority) : undefined,
      familyID: item.FamilyID != null ? Number(item.FamilyID) : undefined,
      family: item.Family != null ? String(item.Family) : undefined,
      referenceID: item.ReferenceID != null ? Number(item.ReferenceID) : undefined,
      publicationTitle: item.PublicationTitle != null ? String(item.PublicationTitle) : undefined,
      fullReference: item.FullReference != null ? String(item.FullReference) : undefined,
      dateOfPublication: item.DateOfPublication != null ? parseDate(item.DateOfPublication) : undefined,
      citation: item.Citation != null ? String(item.Citation) : undefined,
      attributeCode: item.AttributeCode != null ? String(item.AttributeCode) : undefined,
      attributeDescription: item.AttributeDescription != null ? String(item.AttributeDescription) : undefined,
      attributeStatus: item.AttributeStatus != null ? String(item.AttributeStatus) : undefined,
      cmvErrorID: item.CMVErrorID != null ? Number(item.CMVErrorID) : undefined,
      validationErrorID: item.ValidationErrorID != null ? Number(item.ValidationErrorID) : undefined,
      validationErrorDescription: item.ValidationErrorDescription != null ? String(item.ValidationErrorDescription) : undefined,
      validationRunID: item.ValidationRunID != null ? Number(item.ValidationRunID) : undefined,
      procedureName: item.ProcedureName != null ? String(item.ProcedureName) : undefined,
      runDateTime: item.RunDateTime != null ? parseDate(item.RunDateTime) : undefined,
      targetRowID: item.TargetRowID != null ? Number(item.TargetRowID) : undefined,
      validationOutcome: item.ValidationOutcome != null ? String(item.ValidationOutcome) : undefined,
      errorMessage: item.ErrorMessage != null ? String(item.ErrorMessage) : undefined,
      validationCriteria: item.ValidationCriteria != null ? String(item.ValidationCriteria) : undefined,
      measuredValue: item.MeasuredValue != null ? String(item.MeasuredValue) : undefined,
      expectedValueRange: item.ExpectedValueRange != null ? String(item.ExpectedValueRange) : undefined,
      additionalDetails: item.AdditionalDetails != null ? String(item.AdditionalDetails) : undefined,
    }));
  }
}


export const ViewFullTableGridColumns: GridColDef[] = [
  {field: 'coreMeasurementID', headerName: 'Core Measurement ID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'measurementDate', headerName: 'Measurement Date', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'measuredDBH', headerName: 'Measured DBH', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'dbhUnit', headerName: 'DBH Unit', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'measuredHOM', headerName: 'Measured HOM', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'homUnit', headerName: 'HOM Unit', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'coreMeasurementDescription', headerName: 'Description', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'isValidated', headerName: 'Validated', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'userDefinedFields', headerName: 'User Defined Fields', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'plotID', headerName: 'Plot ID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'plotName', headerName: 'Plot Name', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'locationName', headerName: 'Location Name', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'countryName', headerName: 'Country Name', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'dimensionX', headerName: 'Dimension X', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'dimensionY', headerName: 'Dimension Y', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'plotArea', headerName: 'Plot Area', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'globalX', headerName: 'Global X', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'globalY', headerName: 'Global Y', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'globalZ', headerName: 'Global Z', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'plotUnit', headerName: 'Plot Unit', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'plotShape', headerName: 'Plot Shape', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'plotDescription', headerName: 'Plot Description', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'censusID', headerName: 'Census ID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'censusStartDate', headerName: 'Census Start Date', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'censusEndDate', headerName: 'Census End Date', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'censusDescription', headerName: 'Census Description', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'plotCensusNumber', headerName: 'Plot Census Number', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'quadratID', headerName: 'Quadrat ID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'quadratName', headerName: 'Quadrat Name', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'quadratDimensionX', headerName: 'Quadrat Dimension X', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'quadratDimensionY', headerName: 'Quadrat Dimension Y', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'quadratArea', headerName: 'Quadrat Area', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'quadratShape', headerName: 'Quadrat Shape', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'quadratUnit', headerName: 'Quadrat Unit', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'subquadratID', headerName: 'Subquadrat ID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'subquadratName', headerName: 'Subquadrat Name', headerClassName: 'header', flex: 1, align: 'left'},
  {
    field: 'subquadratDimensionX',
    headerName: 'Subquadrat Dimension X',
    headerClassName: 'header',
    flex: 1,
    align: 'left'
  },
  {
    field: 'subquadratDimensionY',
    headerName: 'Subquadrat Dimension Y',
    headerClassName: 'header',
    flex: 1,
    align: 'left'
  },
  {field: 'x', headerName: 'X', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'y', headerName: 'Y', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'subquadratUnit', headerName: 'Subquadrat Unit', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'treeID', headerName: 'Tree ID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'treeTag', headerName: 'Tree Tag', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'stemID', headerName: 'Stem ID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'stemTag', headerName: 'Stem Tag', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'localX', headerName: 'Local X', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'localY', headerName: 'Local Y', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'stemUnit', headerName: 'Stem Unit', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'personnelID', headerName: 'Personnel ID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'firstName', headerName: 'First Name', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'lastName', headerName: 'Last Name', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'personnelRoles', headerName: 'Personnel Roles', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'quadratPersonnelID', headerName: 'Quadrat Personnel ID', headerClassName: 'header', flex: 1, align: 'left'},
  {
    field: 'quadratPersonnelAssignedDate',
    headerName: 'Assigned Date',
    headerClassName: 'header',
    flex: 1,
    align: 'left'
  },
  {field: 'quadratPersonnelRole', headerName: 'Role', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'speciesID', headerName: 'Species ID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'speciesCode', headerName: 'Species Code', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'speciesName', headerName: 'Species Name', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'subspeciesName', headerName: 'Subspecies Name', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'subspeciesAuthority', headerName: 'Subspecies Authority', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'idLevel', headerName: 'ID Level', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'speciesLimitID', headerName: 'Species Limit ID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'limitType', headerName: 'Limit Type', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'upperBound', headerName: 'Upper Bound', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'lowerBound', headerName: 'Lower Bound', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'speciesLimitUnit', headerName: 'Species Limit Unit', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'genusID', headerName: 'Genus ID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'genus', headerName: 'Genus', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'genusAuthority', headerName: 'Genus Authority', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'familyID', headerName: 'Family ID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'family', headerName: 'Family', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'referenceID', headerName: 'Reference ID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'publicationTitle', headerName: 'Publication Title', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'fullReference', headerName: 'Full Reference', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'dateOfPublication', headerName: 'Date Of Publication', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'citation', headerName: 'Citation', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'attributeCode', headerName: 'Attribute Code', headerClassName: 'header', flex: 1, align: 'left'},
  {
    field: 'attributeDescription',
    headerName: 'Attribute Description',
    headerClassName: 'header',
    flex: 1,
    align: 'left'
  },
  {field: 'attributeStatus', headerName: 'Attribute Status', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'cmvErrorID', headerName: 'CMV Error ID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'validationErrorID', headerName: 'Validation Error ID', headerClassName: 'header', flex: 1, align: 'left'},
  {
    field: 'validationErrorDescription',
    headerName: 'Validation Error Description',
    headerClassName: 'header',
    flex: 1,
    align: 'left'
  },
  {field: 'validationRunID', headerName: 'Validation Run ID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'procedureName', headerName: 'Procedure Name', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'runDateTime', headerName: 'Run Date Time', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'targetRowID', headerName: 'Target Row ID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'validationOutcome', headerName: 'Validation Outcome', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'errorMessage', headerName: 'Error Message', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'validationCriteria', headerName: 'Validation Criteria', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'measuredValue', headerName: 'Measured Value', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'expectedValueRange', headerName: 'Expected Value Range', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'additionalDetails', headerName: 'Additional Details', headerClassName: 'header', flex: 1, align: 'left'},
];
