import moment from 'moment';
import { booleanToBit } from './macros';
import { MeasurementsSummaryRDS, MeasurementsSummaryResult } from './sqlrdsdefinitions/views/measurementssummaryviewrds';
import { AllTaxonomiesViewRDS, AllTaxonomiesViewResult } from './sqlrdsdefinitions/views/alltaxonomiesviewrds';
import { SitesMapper } from './sqlrdsdefinitions/tables/sitesrds';
import { SpeciesRDS, SpeciesResult } from './sqlrdsdefinitions/tables/speciesrds';
import { StemTaxonomiesViewRDS, StemTaxonomiesViewResult } from './sqlrdsdefinitions/views/stemtaxonomiesviewrds';
import { ViewFullTableViewRDS, ViewFullTableViewResult } from './sqlrdsdefinitions/views/viewfulltableviewrds';
import { CoreMeasurementsRDS, CoreMeasurementsResult } from './sqlrdsdefinitions/tables/coremeasurementsrds';
import { PlotRDS, PlotsResult } from './sqlrdsdefinitions/tables/plotrds';
import { AttributesRDS, AttributesResult } from './sqlrdsdefinitions/tables/attributerds';
import { QuadratPersonnelRDS, QuadratPersonnelResult } from './sqlrdsdefinitions/tables/quadratpersonnelrds';
import { CensusRDS, CensusResult } from './sqlrdsdefinitions/tables/censusrds';
import { PersonnelRDS, PersonnelResult } from './sqlrdsdefinitions/tables/personnelrds';
import { QuadratRDS, QuadratsResult } from './sqlrdsdefinitions/tables/quadratrds';
import { StemRDS, StemResult } from './sqlrdsdefinitions/tables/stemrds';
import { UnifiedChangelogRDS, UnifiedChangelogResult } from '@/config/sqlrdsdefinitions/tables/unifiedchangelogrds';

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
  mapData(results: Result[], indexOffset: number = 1): RDS[] {
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
          if (key === 'id') continue; // Ensure id is removed
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
    return key.replace(/dbh/gi, 'DBH').replace(/hom/gi, 'HOM').replace(/id/gi, 'ID');
  }

  private detransformSpecialCases(key: string): string {
    return key
      .replace(/DBHUnits/gi, 'dbhUnits')
      .replace(/HOMUnits/gi, 'homUnits')
      .replace(/measureddbh/gi, 'measuredDBH')
      .replace(/measuredhom/gi, 'measuredHOM');
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
    } else if (typeof value === 'boolean' && value === false) {
      return undefined;
    } else if (typeof value === 'string' && value === '') {
      return undefined;
    } else if (key.toLowerCase().includes('date') && value !== null) {
      return parseDate(value);
    } else if (value !== undefined && value !== null) {
      return value;
    } else {
      return null;
    }
  }
}

class MapperFactory {
  static getMapper<RDS, Result>(type: string): IDataMapper<RDS, Result> {
    switch (type) {
      // tables
      case 'coremeasurements':
        return new GenericMapper<CoreMeasurementsRDS, CoreMeasurementsResult>() as unknown as IDataMapper<RDS, Result>;
      case 'sites':
        return new SitesMapper() as any;
      case 'plots':
        return new GenericMapper<PlotRDS, PlotsResult>() as unknown as IDataMapper<RDS, Result>;
      case 'attributes':
        return new GenericMapper<AttributesRDS, AttributesResult>() as unknown as IDataMapper<RDS, Result>;
      case 'quadratpersonnel':
        return new GenericMapper<QuadratPersonnelRDS, QuadratPersonnelResult>() as unknown as IDataMapper<RDS, Result>;
      case 'census':
        return new GenericMapper<CensusRDS, CensusResult>() as unknown as IDataMapper<RDS, Result>;
      case 'personnel':
        return new GenericMapper<PersonnelRDS, PersonnelResult>() as unknown as IDataMapper<RDS, Result>;
      case 'quadrats':
        return new GenericMapper<QuadratRDS, QuadratsResult>() as unknown as IDataMapper<RDS, Result>;
      case 'species':
        return new GenericMapper<SpeciesRDS, SpeciesResult>() as unknown as IDataMapper<RDS, Result>;
      case 'stems':
        return new GenericMapper<StemRDS, StemResult>() as unknown as IDataMapper<RDS, Result>;
      case 'unifiedchangelog':
        return new GenericMapper<UnifiedChangelogRDS, UnifiedChangelogResult>() as unknown as IDataMapper<RDS, Result>;
      // views:
      case 'alltaxonomiesview':
        return new GenericMapper<AllTaxonomiesViewRDS, AllTaxonomiesViewResult>() as unknown as IDataMapper<RDS, Result>;
      case 'stemtaxonomiesview':
        return new GenericMapper<StemTaxonomiesViewRDS, StemTaxonomiesViewResult>() as unknown as IDataMapper<RDS, Result>;
      case 'measurementssummaryview':
      case 'measurementssummary':
        return new GenericMapper<MeasurementsSummaryRDS, MeasurementsSummaryResult>() as unknown as IDataMapper<RDS, Result>;
      case 'viewfulltableview':
      case 'viewfulltable':
        return new GenericMapper<ViewFullTableViewRDS, ViewFullTableViewResult>() as unknown as IDataMapper<RDS, Result>;
      default:
        throw new Error('Mapper not found for type: ' + type);
    }
  }
}

export default MapperFactory;
