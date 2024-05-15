import {IDataMapper, parseDate} from "@/config/datamapper";
import {GridColDef} from "@mui/x-data-grid";
import {bitToBoolean} from "@/config/macros";

export type ViewFullTableRDS = {
  id: number;
  coreMeasurementID: number;
  measurementDate: Date | null;
  measuredDBH: number | null;
  dbhUnit: string | null;
  measuredHOM: number | null;
  homUnit: string | null;
  coreMeasurementDescription: string | null;
  isValidated: boolean | null;
  userDefinedFields: string | null;
  plotID: number | null;
  plotName: string | null;
  locationName: string | null;
  countryName: string | null;
  dimensionX: number | null;
  dimensionY: number | null;
  plotArea: number | null;
  globalX: number | null;
  globalY: number | null;
  globalZ: number | null;
  plotUnit: string | null;
  plotShape: string | null;
  plotDescription: string | null;
  censusID: number | null;
  censusStartDate: Date | null;
  censusEndDate: Date | null;
  censusDescription: string | null;
  plotCensusNumber: number | null;
  quadratID: number | null;
  quadratName: string | null;
  quadratDimensionX: number | null;
  quadratDimensionY: number | null;
  quadratArea: number | null;
  quadratShape: string | null;
  quadratUnit: string | null;
  subquadratID: number | null;
  subquadratName: string | null;
  subquadratDimensionX: number | null;
  subquadratDimensionY: number | null;
  x: number | null;
  y: number | null;
  subquadratUnit: string | null;
  treeID: number | null;
  treeTag: string | null;
  stemID: number | null;
  stemTag: string | null;
  localX: number | null;
  localY: number | null;
  stemUnit: string | null;
  personnelID: number | null;
  firstName: string | null;
  lastName: string | null;
  personnelRoles: string | null;
  quadratPersonnelID: number | null;
  quadratPersonnelAssignedDate: Date | null;
  quadratPersonnelRole: string | null;
  speciesID: number | null;
  speciesCode: string | null;
  speciesName: string | null;
  subspeciesName: string | null;
  subspeciesAuthority: string | null;
  idLevel: string | null;
  speciesLimitID: number | null;
  limitType: string | null;
  upperBound: number | null;
  lowerBound: number | null;
  speciesLimitUnit: string | null;
  genusID: number | null;
  genus: string | null;
  genusAuthority: string | null;
  familyID: number | null;
  family: string | null;
  referenceID: number | null;
  publicationTitle: string | null;
  fullReference: string | null;
  dateOfPublication: Date | null;
  citation: string | null;
  attributeCode: string | null;
  attributeDescription: string | null;
  attributeStatus: string | null;
  cmvErrorID: number | null;
  validationErrorID: number | null;
  validationErrorDescription: string | null;
  validationRunID: number | null;
  procedureName: string | null;
  runDateTime: Date | null;
  targetRowID: number | null;
  validationOutcome: string | null;
  errorMessage: string | null;
  validationCriteria: string | null;
  measuredValue: string | null;
  expectedValueRange: string | null;
  additionalDetails: string | null;
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
      CoreMeasurementID: item.coreMeasurementID,
      MeasurementDate: item.measurementDate,
      MeasuredDBH: item.measuredDBH,
      DBHUnit: item.dbhUnit,
      MeasuredHOM: item.measuredHOM,
      HOMUnit: item.homUnit,
      CoreMeasurementDescription: item.coreMeasurementDescription,
      IsValidated: item.isValidated,
      UserDefinedFields: item.userDefinedFields,
      PlotID: item.plotID,
      PlotName: item.plotName,
      LocationName: item.locationName,
      CountryName: item.countryName,
      DimensionX: item.dimensionX,
      DimensionY: item.dimensionY,
      PlotArea: item.plotArea,
      GlobalX: item.globalX,
      GlobalY: item.globalY,
      GlobalZ: item.globalZ,
      PlotUnit: item.plotUnit,
      PlotShape: item.plotShape,
      PlotDescription: item.plotDescription,
      CensusID: item.censusID,
      CensusStartDate: item.censusStartDate,
      CensusEndDate: item.censusEndDate,
      CensusDescription: item.censusDescription,
      PlotCensusNumber: item.plotCensusNumber,
      QuadratID: item.quadratID,
      QuadratName: item.quadratName,
      QuadratDimensionX: item.quadratDimensionX,
      QuadratDimensionY: item.quadratDimensionY,
      QuadratArea: item.quadratArea,
      QuadratShape: item.quadratShape,
      QuadratUnit: item.quadratUnit,
      SubquadratID: item.subquadratID,
      SubquadratName: item.subquadratName,
      SubquadratDimensionX: item.subquadratDimensionX,
      SubquadratDimensionY: item.subquadratDimensionY,
      X: item.x,
      Y: item.y,
      SubquadratUnit: item.subquadratUnit,
      TreeID: item.treeID,
      TreeTag: item.treeTag,
      StemID: item.stemID,
      StemTag: item.stemTag,
      LocalX: item.localX,
      LocalY: item.localY,
      StemUnit: item.stemUnit,
      PersonnelID: item.personnelID,
      FirstName: item.firstName,
      LastName: item.lastName,
      PersonnelRoles: item.personnelRoles,
      QuadratPersonnelID: item.quadratPersonnelID,
      QuadratPersonnelAssignedDate: item.quadratPersonnelAssignedDate,
      QuadratPersonnelRole: item.quadratPersonnelRole,
      SpeciesID: item.speciesID,
      SpeciesCode: item.speciesCode,
      SpeciesName: item.speciesName,
      SubspeciesName: item.subspeciesName,
      SubspeciesAuthority: item.subspeciesAuthority,
      IDLevel: item.idLevel,
      SpeciesLimitID: item.speciesLimitID,
      LimitType: item.limitType,
      UpperBound: item.upperBound,
      LowerBound: item.lowerBound,
      SpeciesLimitUnit: item.speciesLimitUnit,
      GenusID: item.genusID,
      Genus: item.genus,
      GenusAuthority: item.genusAuthority,
      FamilyID: item.familyID,
      Family: item.family,
      ReferenceID: item.referenceID,
      PublicationTitle: item.publicationTitle,
      FullReference: item.fullReference,
      DateOfPublication: item.dateOfPublication,
      Citation: item.citation,
      AttributeCode: item.attributeCode,
      AttributeDescription: item.attributeDescription,
      AttributeStatus: item.attributeStatus,
      CMVErrorID: item.cmvErrorID,
      ValidationErrorID: item.validationErrorID,
      ValidationErrorDescription: item.validationErrorDescription,
      ValidationRunID: item.validationRunID,
      ProcedureName: item.procedureName,
      RunDateTime: item.runDateTime,
      TargetRowID: item.targetRowID,
      ValidationOutcome: item.validationOutcome,
      ErrorMessage: item.errorMessage,
      ValidationCriteria: item.validationCriteria,
      MeasuredValue: item.measuredValue,
      ExpectedValueRange: item.expectedValueRange,
      AdditionalDetails: item.additionalDetails,
    }));
  }

  mapData(results: ViewFullTableResult[], indexOffset: number = 1): ViewFullTableRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      coreMeasurementID: Number(item.CoreMeasurementID),
      measurementDate: parseDate(item.MeasurementDate),
      measuredDBH: Number(item.MeasuredDBH),
      dbhUnit: String(item.DBHUnit),
      measuredHOM: Number(item.MeasuredHOM),
      homUnit: String(item.HOMUnit),
      coreMeasurementDescription: String(item.CoreMeasurementDescription),
      isValidated: bitToBoolean(item.IsValidated),
      userDefinedFields: String(item.UserDefinedFields),
      plotID: Number(item.PlotID),
      plotName: String(item.PlotName),
      locationName: String(item.LocationName),
      countryName: String(item.CountryName),
      dimensionX: Number(item.DimensionX),
      dimensionY: Number(item.DimensionY),
      plotArea: Number(item.PlotArea),
      globalX: Number(item.GlobalX),
      globalY: Number(item.GlobalY),
      globalZ: Number(item.GlobalZ),
      plotUnit: String(item.PlotUnit),
      plotShape: String(item.PlotShape),
      plotDescription: String(item.PlotDescription),
      censusID: Number(item.CensusID),
      censusStartDate: parseDate(item.CensusStartDate),
      censusEndDate: parseDate(item.CensusEndDate),
      censusDescription: String(item.CensusDescription),
      plotCensusNumber: Number(item.PlotCensusNumber),
      quadratID: Number(item.QuadratID),
      quadratName: String(item.QuadratName),
      quadratDimensionX: Number(item.QuadratDimensionX),
      quadratDimensionY: Number(item.QuadratDimensionY),
      quadratArea: Number(item.QuadratArea),
      quadratShape: String(item.QuadratShape),
      quadratUnit: String(item.QuadratUnit),
      subquadratID: Number(item.SubquadratID),
      subquadratName: String(item.SubquadratName),
      subquadratDimensionX: Number(item.SubquadratDimensionX),
      subquadratDimensionY: Number(item.SubquadratDimensionY),
      x: Number(item.X),
      y: Number(item.Y),
      subquadratUnit: String(item.SubquadratUnit),
      treeID: Number(item.TreeID),
      treeTag: String(item.TreeTag),
      stemID: Number(item.StemID),
      stemTag: String(item.StemTag),
      localX: Number(item.LocalX),
      localY: Number(item.LocalY),
      stemUnit: String(item.StemUnit),
      personnelID: Number(item.PersonnelID),
      firstName: String(item.FirstName),
      lastName: String(item.LastName),
      personnelRoles: String(item.PersonnelRoles),
      quadratPersonnelID: Number(item.QuadratPersonnelID),
      quadratPersonnelAssignedDate: parseDate(item.QuadratPersonnelAssignedDate),
      quadratPersonnelRole: String(item.QuadratPersonnelRole),
      speciesID: Number(item.SpeciesID),
      speciesCode: String(item.SpeciesCode),
      speciesName: String(item.SpeciesName),
      subspeciesName: String(item.SubspeciesName),
      subspeciesAuthority: String(item.SubspeciesAuthority),
      idLevel: String(item.IDLevel),
      speciesLimitID: Number(item.SpeciesLimitID),
      limitType: String(item.LimitType),
      upperBound: Number(item.UpperBound),
      lowerBound: Number(item.LowerBound),
      speciesLimitUnit: String(item.SpeciesLimitUnit),
      genusID: Number(item.GenusID),
      genus: String(item.Genus),
      genusAuthority: String(item.GenusAuthority),
      familyID: Number(item.FamilyID),
      family: String(item.Family),
      referenceID: Number(item.ReferenceID),
      publicationTitle: String(item.PublicationTitle),
      fullReference: String(item.FullReference),
      dateOfPublication: parseDate(item.DateOfPublication),
      citation: String(item.Citation),
      attributeCode: String(item.AttributeCode),
      attributeDescription: String(item.AttributeDescription),
      attributeStatus: String(item.AttributeStatus),
      cmvErrorID: Number(item.CMVErrorID),
      validationErrorID: Number(item.ValidationErrorID),
      validationErrorDescription: String(item.ValidationErrorDescription),
      validationRunID: Number(item.ValidationRunID),
      procedureName: String(item.ProcedureName),
      runDateTime: parseDate(item.RunDateTime),
      targetRowID: Number(item.TargetRowID),
      validationOutcome: String(item.ValidationOutcome),
      errorMessage: String(item.ErrorMessage),
      validationCriteria: String(item.ValidationCriteria),
      measuredValue: String(item.MeasuredValue),
      expectedValueRange: String(item.ExpectedValueRange),
      additionalDetails: String(item.AdditionalDetails),
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
