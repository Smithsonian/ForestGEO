// viewfulltableview custom data type
import { ColumnStates, Common, Unique } from "@/config/macros";
import { MeasurementsSummaryMapper, MeasurementsSummaryRDS, MeasurementsSummaryResult } from "./measurementssummaryviewrds";
import { StemTaxonomiesMapper, StemTaxonomiesViewRDS, StemTaxonomiesViewResult } from "./stemtaxonomiesviewrds";
import { IDataMapper } from "@/config/datamapper";

export type ViewFullTableViewRDS = Common<MeasurementsSummaryRDS, StemTaxonomiesViewRDS> & Unique<MeasurementsSummaryRDS, StemTaxonomiesViewRDS>;
export type ViewFullTableViewResult = Common<MeasurementsSummaryResult, StemTaxonomiesViewResult> & Unique<MeasurementsSummaryResult, StemTaxonomiesViewResult>;

export class ViewFullTableMapper implements IDataMapper<ViewFullTableViewResult, ViewFullTableViewRDS> {
  private measurementsSummaryMapper = new MeasurementsSummaryMapper();
  private stemTaxonomiesMapper = new StemTaxonomiesMapper();
  demapData(results: ViewFullTableViewRDS[]): ViewFullTableViewResult[] {
    const measurementsResults = this.measurementsSummaryMapper.demapData(results as MeasurementsSummaryRDS[]);
    const stemTaxonomiesResults = this.stemTaxonomiesMapper.demapData(results as StemTaxonomiesViewRDS[]);

    return results.map((item, index) => ({
      ...measurementsResults[index],
      ...stemTaxonomiesResults[index]
    }));
  }

  mapData(results: ViewFullTableViewResult[], indexOffset: number = 1): ViewFullTableViewRDS[] {
    // Convert results to unknown to bypass type checks
    const measurementsResults = results as unknown as MeasurementsSummaryResult[];
    const stemTaxonomiesResults = results as unknown as StemTaxonomiesViewResult[];

    const measurementsMapped = this.measurementsSummaryMapper.mapData(measurementsResults, indexOffset);
    const stemTaxonomiesMapped = this.stemTaxonomiesMapper.mapData(stemTaxonomiesResults, indexOffset);

    return measurementsMapped.map((measurementResult, index) => ({
      ...measurementResult,
      ...stemTaxonomiesMapped[index]
    }));
  }
}

export const initialViewFullTableViewRDS: ViewFullTableViewRDS = {
  id: 0,
  coreMeasurementID: 0,
  plotID: 0,
  plotName: '',
  censusID: 0,
  quadratID: 0,
  quadratName: '',
  subquadratID: 0,
  subquadratName: '',
  speciesID: 0,
  speciesCode: '',
  treeID: 0,
  treeTag: '',
  stemID: 0,
  stemTag: '',
  stemLocalX: 0,
  stemLocalY: 0,
  stemUnits: '',
  personnelID: 0,
  personnelName: '',
  measurementDate: null,
  measuredDBH: 0,
  dbhUnits: '',
  measuredHOM: 0,
  homUnits: '',
  isValidated: false,
  description: '',
  attributes: '',
  familyID: 0,
  genusID: 0,
  speciesName: '',
  subspeciesName: '',
  validCode: '',
  genusAuthority: '',
  speciesAuthority: '',
  subspeciesAuthority: '',
  speciesIDLevel: '',
  speciesFieldFamily: '',
  family: '',
  genus: '',
};

export function getAllViewFullTableViewsHCs(): ColumnStates {
  return {
    plotID: false,
    censusID: false,
    quadratID: false,
    subquadratID: false,
    speciesID: false,
    treeID: false,
    stemID: false,
    personnelID: false,
    familyID: false,
    genusID: false,
  };
};