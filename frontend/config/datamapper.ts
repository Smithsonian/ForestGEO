import moment from 'moment';
import { bitToBoolean, booleanToBit } from './macros';
import { Common, ResultType, Unique } from '@/config/utils';
import {
  FamilyRDS,
  FamilyResult,
  GenusRDS,
  GenusResult,
  ReferenceRDS,
  ReferenceResult,
  SpeciesInventoryRDS,
  SpeciesInventoryResult,
  SpeciesLimitsRDS,
  SpeciesLimitsResult,
  SpeciesRDS,
  SpeciesResult,
  SpecimensRDS,
  SpecimensResult,
  StemRDS,
  StemResult,
  TreeRDS,
  TreeResult
} from '@/config/sqlrdsdefinitions/taxonomies';
import { PlotRDS, PlotsResult, QuadratRDS, QuadratResult, SitesMapper } from '@/config/sqlrdsdefinitions/zones';
import {
  AllTaxonomiesViewRDS,
  AllTaxonomiesViewResult,
  MeasurementsSummaryRDS,
  MeasurementsSummaryResult,
  ViewFullTableRDS,
  ViewFullTableResult
} from '@/config/sqlrdsdefinitions/views';
import {
  PostValidationQueriesRDS,
  PostValidationQueriesResult,
  ValidationChangelogRDS,
  ValidationChangelogResult,
  ValidationProceduresRDS,
  ValidationProceduresResult
} from '@/config/sqlrdsdefinitions/validations';
import { CensusRDS, CensusResult } from '@/config/sqlrdsdefinitions/timekeeping';
import { PersonnelRDS, PersonnelResult, QuadratPersonnelRDS, QuadratPersonnelResult, RoleRDS, RoleResult } from '@/config/sqlrdsdefinitions/personnel';
import {
  AttributesRDS,
  AttributesResult,
  CMAttributesRDS,
  CMAttributesResult,
  CMVErrorRDS,
  CMVErrorResult,
  CoreMeasurementsRDS,
  CoreMeasurementsResult,
  FailedMeasurementsRDS,
  FailedMeasurementsResult,
  StagingCoreMeasurementsRDS,
  StagingCoreMeasurementsResult,
  UnifiedChangelogRDS,
  UnifiedChangelogResult
} from '@/config/sqlrdsdefinitions/core';
import { AdminSiteRDS, AdminSiteResult, AdminUserRDS, AdminUserResult } from '@/config/sqlrdsdefinitions/admin';
import { AdminUserSiteRelationRDS, AdminUserSiteRelationResult } from './sqlrdsdefinitions/admin';

export function parseDate(date: any): Date | undefined {
  if (!date) return undefined;
  // Check if date is a number (UNIX timestamp), string, or already a Date object
  if (typeof date === 'number') {
    return moment(new Date(date * 1000))
      .utc()
      .toDate(); // Convert UNIX timestamp to milliseconds
  } else if (typeof date === 'string') {
    return moment(new Date(date)).utc().toDate(); // Convert date string to Date object
  } else if (date instanceof Date) {
    return moment(date).utc().toDate(); // Already a Date object
  } else {
    return undefined; // Invalid type for date
  }
}

export interface IDataMapper<RDS, Result> {
  mapData(results: Result[], indexOffset?: number): RDS[];

  demapData(results: RDS[]): Result[];
}

export class GenericMapper<RDS, Result> implements IDataMapper<RDS, Result> {
  mapData(results: Result[], indexOffset = 1): RDS[] {
    return results.map((item, index) => {
      const rds: any = {};
      for (const key in item) {
        if (Object.prototype.hasOwnProperty.call(item, key)) {
          const originalKey = this.decapitalizeAndDetransformKey(key);
          rds[originalKey] = this.detransformValue(item[key], originalKey, index + indexOffset);
        }
      }
      if (!rds.id) {
        rds.id = index + indexOffset; // Ensure id is added
      }
      return rds;
    });
  }

  demapData(results: RDS[]): Result[] {
    return results.map(item => {
      const result: any = {};
      for (const key in item) {
        if (Object.prototype.hasOwnProperty.call(item, key)) {
          if (key === 'id') continue;
          const capitalizedKey = this.capitalizeAndTransformKey(key);
          result[capitalizedKey] = this.transformValue(item[key]);
        }
      }
      return result;
    });
  }

  private capitalizeAndTransformKey(key: string): string {
    const transformedKey = this.transformSpecialCases(key);
    return transformedKey.charAt(0).toUpperCase() + transformedKey.slice(1);
  }

  private decapitalizeAndDetransformKey(key: string): string {
    const decapitalizedKey = key.charAt(0).toLowerCase() + key.slice(1);
    return this.detransformSpecialCases(decapitalizedKey);
  }

  private transformSpecialCases(key: string): string {
    // Add special handling for ValidCode before applying the ID transformation
    if (/validcode/i.test(key)) {
      return key.replace(/validcode/gi, 'ValidCode');
    }

    // Existing transformations for DBH, HOM, CMA, and ID
    return key
      .replace(/sqDimX/gi, 'SQDimX')
      .replace(/sqDimY/gi, 'SQDimY')
      .replace(/defaultUOMDBH/gi, 'DefaultUOMDBH')
      .replace(/defaultUOMHOM/gi, 'DefaultUOMHOM')
      .replace(/dbh/gi, 'DBH')
      .replace(/hom/gi, 'HOM')
      .replace(/cma/gi, 'CMA')
      .replace(/id/gi, 'ID')
      .replace(/spCode/gi, 'SpCode');
  }

  private detransformSpecialCases(key: string): string {
    if (key === 'MeasuredDBH') return 'measuredDBH';
    if (key === 'MeasuredHOM') return 'measuredHOM';
    if (key === 'DefaultUOMHOM') return 'defaultUOMHOM';
    if (key === 'DefaultUOMDBH') return 'defaultUOMDBH';
    return (
      key
        // Add reverse transformation for ValidCode
        .replace(/SQDimX/gi, 'sqDimX')
        .replace(/SQDimY/gi, 'sqDimY')
        .replace(/DBH/gi, 'dbh')
        .replace(/HOM/gi, 'hom')
        .replace(/IDLevel/gi, 'idLevel')
        .replace(/ValidCode/gi, 'validCode')
        .replace(/DefaultDBHUnits/gi, 'defaultDBHUnits')
        .replace(/DefaultHOMUnits/gi, 'defaultHOMUnits')
        .replace(/measureddbh/gi, 'measuredDBH')
        .replace(/measuredhom/gi, 'measuredHOM')
        .replace(/cam/gi, 'CAM')
        .replace(/Cam/gi, 'CAM')
        .replace(/SpCode/gi, 'spCode')
    );
  }

  private transformValue(value: any): any {
    if (typeof value === 'boolean') {
      return booleanToBit(value);
    } else if (value instanceof Date) {
      return value.toISOString();
    } else if (value !== undefined && value !== null) {
      return value;
    } else {
      return null;
    }
  }

  private detransformValue(value: any, key: string, indexOffset: number): any {
    if (key === 'id') {
      return indexOffset;
    } else if (typeof value === 'number' && value === 0) {
      return undefined;
    } else if (typeof value === 'boolean' && !value) {
      return undefined;
    } else if (typeof value === 'string' && value === '') {
      return undefined;
    }
    // Check for buffers and Uint8Arrays first
    else if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
      return bitToBoolean(value);
    }
    // dynamically detect if values are decimal and provide handling
    else if (this.isDecimal(value)) {
      return parseFloat(value.toFixed(2));
    }
    // Now process date-like fields more carefully
    else if (this.isDateKey(key) && value !== null) {
      return parseDate(value);
    } else if (value !== undefined && value !== null) {
      return value;
    } else {
      return null;
    }
  }

  // Helper function to identify date-like keys more specifically
  private isDateKey(key: string): boolean {
    const lowerKey = key.toLowerCase();
    // Add other specific date-related keys as needed
    return ['measurementdate', 'createddate', 'updateddate'].includes(lowerKey);
  }

  private isDecimal(value: any): boolean {
    if (typeof value !== 'number') return false;

    // Check if the number has more than 2 decimal places
    const decimalPlaces = (value.toString().split('.')[1] || '').length;

    return decimalPlaces > 2; // If more than 2 decimal places, it's likely a DECIMAL type
  }
}

class MapperFactory {
  static getMapper<RDS, Result>(type: string): IDataMapper<RDS, Result> {
    switch (type) {
      // tables
      case 'alltaxonomiesview':
        return new GenericMapper<AllTaxonomiesViewRDS, AllTaxonomiesViewResult>() as unknown as IDataMapper<RDS, Result>;
      case 'attributes':
        return new GenericMapper<AttributesRDS, AttributesResult>() as unknown as IDataMapper<RDS, Result>;
      case 'census':
        return new GenericMapper<CensusRDS, CensusResult>() as unknown as IDataMapper<RDS, Result>;
      case 'coremeasurements':
        return new GenericMapper<CoreMeasurementsRDS, CoreMeasurementsResult>() as unknown as IDataMapper<RDS, Result>;
      case 'coremeasurements_staging':
        return new GenericMapper<StagingCoreMeasurementsRDS, StagingCoreMeasurementsResult>() as unknown as IDataMapper<RDS, Result>;
      case 'cmverrors':
        return new GenericMapper<CMVErrorRDS, CMVErrorResult>() as unknown as IDataMapper<RDS, Result>;
      case 'cmattributes':
        return new GenericMapper<CMAttributesRDS, CMAttributesResult>() as unknown as IDataMapper<RDS, Result>;
      case 'failedmeasurements':
        return new GenericMapper<FailedMeasurementsRDS, FailedMeasurementsResult>() as unknown as IDataMapper<RDS, Result>;
      case 'measurementssummary':
      case 'measurementssummaryview':
        return new GenericMapper<MeasurementsSummaryRDS, MeasurementsSummaryResult>() as unknown as IDataMapper<RDS, Result>;
      case 'personnel':
        return new GenericMapper<PersonnelRDS, PersonnelResult>() as unknown as IDataMapper<RDS, Result>;
      case 'personnelrole':
        return new GenericMapper<
          Unique<PersonnelRDS, RoleRDS> & Unique<RoleRDS, PersonnelRDS> & Common<PersonnelRDS, RoleRDS>,
          ResultType<Unique<PersonnelRDS, RoleRDS> & Unique<RoleRDS, PersonnelRDS> & Common<PersonnelRDS, RoleRDS>>
        >() as unknown as IDataMapper<RDS, Result>;
      case 'roles':
        return new GenericMapper<RoleRDS, RoleResult>() as unknown as IDataMapper<RDS, Result>;
      case 'plots':
        return new GenericMapper<PlotRDS, PlotsResult>() as unknown as IDataMapper<RDS, Result>;
      case 'postvalidationqueries':
        return new GenericMapper<PostValidationQueriesRDS, PostValidationQueriesResult>() as unknown as IDataMapper<RDS, Result>;
      case 'quadratpersonnel':
        return new GenericMapper<QuadratPersonnelRDS, QuadratPersonnelResult>() as unknown as IDataMapper<RDS, Result>;
      case 'quadrats':
        return new GenericMapper<QuadratRDS, QuadratResult>() as unknown as IDataMapper<RDS, Result>;
      case 'family':
        return new GenericMapper<FamilyRDS, FamilyResult>() as unknown as IDataMapper<RDS, Result>;
      case 'genus':
        return new GenericMapper<GenusRDS, GenusResult>() as unknown as IDataMapper<RDS, Result>;
      case 'reference':
        return new GenericMapper<ReferenceRDS, ReferenceResult>() as unknown as IDataMapper<RDS, Result>;
      case 'species':
        return new GenericMapper<SpeciesRDS, SpeciesResult>() as unknown as IDataMapper<RDS, Result>;
      case 'speciesinventory':
        return new GenericMapper<SpeciesInventoryRDS, SpeciesInventoryResult>() as unknown as IDataMapper<RDS, Result>;
      case 'specieslimits':
        return new GenericMapper<SpeciesLimitsRDS, SpeciesLimitsResult>() as unknown as IDataMapper<RDS, Result>;
      case 'specimens':
        return new GenericMapper<SpecimensRDS, SpecimensResult>() as unknown as IDataMapper<RDS, Result>;
      case 'stems':
        return new GenericMapper<StemRDS, StemResult>() as unknown as IDataMapper<RDS, Result>;
      case 'trees':
        return new GenericMapper<TreeRDS, TreeResult>() as unknown as IDataMapper<RDS, Result>;
      case 'unifiedchangelog':
        return new GenericMapper<UnifiedChangelogRDS, UnifiedChangelogResult>() as unknown as IDataMapper<RDS, Result>;
      case 'validationchangelog':
        return new GenericMapper<ValidationChangelogRDS, ValidationChangelogResult>() as unknown as IDataMapper<RDS, Result>;
      case 'sitespecificvalidations':
        return new GenericMapper<ValidationProceduresRDS, ValidationProceduresResult>() as unknown as IDataMapper<RDS, Result>;
      case 'viewfulltable':
      case 'viewfulltableview':
        return new GenericMapper<ViewFullTableRDS, ViewFullTableResult>() as unknown as IDataMapper<RDS, Result>;
      // admin
      case 'users':
        return new GenericMapper<AdminUserRDS, AdminUserResult>() as unknown as IDataMapper<RDS, Result>;
      case 'sites':
        return new GenericMapper<AdminSiteRDS, AdminSiteResult>() as unknown as IDataMapper<RDS, Result>;
      case 'usersiterelations':
        return new GenericMapper<AdminUserSiteRelationRDS, AdminUserSiteRelationResult>() as unknown as IDataMapper<RDS, Result>;
      default:
        throw new Error('Mapper not found for type: ' + type);
    }
  }
}

export default MapperFactory;
