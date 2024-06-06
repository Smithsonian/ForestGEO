import { AttributesMapper } from "./sqlrdsdefinitions/tables/attributerds";
import { CensusMapper } from "./sqlrdsdefinitions/tables/censusrds";
import { CoreMeasurementsMapper } from "./sqlrdsdefinitions/tables/coremeasurementsrds";
import { MeasurementsSummaryMapper } from "./sqlrdsdefinitions/views/measurementssummaryviewrds";
import { PersonnelMapper } from "./sqlrdsdefinitions/tables/personnelrds";
import { QuadratsMapper } from "./sqlrdsdefinitions/tables/quadratrds";
import { SitesMapper } from "./sqlrdsdefinitions/tables/sitesrds";
import { SpeciesMapper } from "./sqlrdsdefinitions/tables/speciesrds";
import { StemsMapper } from "./sqlrdsdefinitions/tables/stemrds";
import { StemDimensionsMapper } from "./sqlrdsdefinitions/views/stemdimensionsviewrds";
import { SubquadratsMapper } from "./sqlrdsdefinitions/tables/subquadratrds";
import { AllTaxonomiesViewMapper } from "./sqlrdsdefinitions/views/alltaxonomyviewrds";
import { ValidationHistoryMapper } from "./sqlrdsdefinitions/tables/valchangelogrds";
import { PlotsMapper } from "./sqlrdsdefinitions/tables/plotrds";
import { StemTaxonomiesMapper } from "./sqlrdsdefinitions/views/stemtaxonomyviewrds";
import { QuadratPersonnelMapper } from "./sqlrdsdefinitions/tables/quadratpersonnelrds";
import moment from "moment";

export function parseDate(date: any): Date | undefined {
  if (!date || date === null) return undefined;
  // Check if date is a number (UNIX timestamp), string, or already a Date object
  if (typeof date === 'number') {
    return moment(new Date(date * 1000)).utc().toDate() ; // Convert UNIX timestamp to milliseconds
  } else if (typeof date === 'string') {
    return moment(new Date(date)).utc().toDate(); // Convert date string to Date object
  } else if (date instanceof Date) {
    return moment(date).utc().toDate(); // Already a Date object
  } else {
    return undefined; // Invalid type for date
  }
}

export interface IDataMapper<T, U> {
  mapData(results: T[], indexOffset?: number): U[];
  demapData(results: U[]): T[];
}

class MapperFactory {
  static getMapper<T, U>(type: string): IDataMapper<T, U> {
    switch (type) {
      // tables
      case 'coremeasurements':
        return new CoreMeasurementsMapper() as any;
      case 'validationhistory':
        return new ValidationHistoryMapper() as any;
      case 'sites':
        return new SitesMapper() as any;
      case 'plots':
        return new PlotsMapper() as any;
      case 'attributes':
        return new AttributesMapper() as any;
      case 'quadratpersonnel':
        return new QuadratPersonnelMapper as any;
      case 'census':
        return new CensusMapper() as any;
      case 'personnel':
        return new PersonnelMapper() as any;
      case 'quadrats':
        return new QuadratsMapper() as any;
      case 'species':
        return new SpeciesMapper() as any;
      case 'stems':
        return new StemsMapper() as any;
      case 'subquadrats':
        return new SubquadratsMapper() as any;
      // views:
      case 'alltaxonomiesview':
        return new AllTaxonomiesViewMapper() as any;
      case 'stemdimensionsview':
        return new StemDimensionsMapper() as any;
      case 'stemtaxonomiesview':
        return new StemTaxonomiesMapper() as any;
      case 'measurementssummaryview':
        return new MeasurementsSummaryMapper() as any;
      default:
        throw new Error('Mapper not found for type: ' + type);
    }
  }
}

export default MapperFactory;