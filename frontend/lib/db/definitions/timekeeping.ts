import { ResultType } from '@/config/utils';
import MapperFactory, { IDataMapper } from '@/config/datamapper';
import { bitToBoolean } from '@/config/macros/bitconversion';
import type { CensusDates } from '@/config/censuswindow';

// Types and constants
export type CensusRDS =
  | {
      id?: number;
      censusID?: number;
      plotID?: number;
      plotCensusNumber?: number;
      startDate?: Date;
      endDate?: Date;
      censusStartDate?: Date | null;
      censusEndDate?: Date | null;
      firstMeasurementDate?: Date | null;
      lastMeasurementDate?: Date | null;
      description?: string;
      // mysql2 returns TINYINT(1) as a number; GenericMapper turns 0 into undefined.
      isActive?: number | boolean;
    }
  | undefined;
export type CensusResult = ResultType<CensusRDS>;

export interface CensusDateRange {
  censusID: number;
  /** Legacy: measurement span when the census has data, census window otherwise. */
  startDate?: Date;
  endDate?: Date;
  /** Census window (census.StartDate / EndDate). SQL DATE values; JSON delivers them as ISO strings. */
  censusStartDate?: Date | null;
  censusEndDate?: Date | null;
  /** Observed measurement span; null when the census has no measurements. */
  firstMeasurementDate?: Date | null;
  lastMeasurementDate?: Date | null;
}

export interface OrgCensusRDS {
  plotID: number;
  plotCensusNumber: number;
  censusIDs: number[];
  dateRanges: CensusDateRange[];
  description: string;
  isActive: boolean;
}

export type OrgCensus = OrgCensusRDS | undefined;

// Mapper class
export class OrgCensusToCensusResultMapper {
  private censusMapper: IDataMapper<CensusRDS, CensusResult>;

  constructor() {
    this.censusMapper = MapperFactory.getMapper('census');
  }

  demapData(censusResultList: CensusResult[]): OrgCensusRDS[] {
    const censusRDSList = this.censusMapper.mapData(censusResultList);
    const uniqueCensusMap = new Map<number, OrgCensusRDS>();

    censusRDSList.forEach(censusRDS => {
      if (!censusRDS) throw new Error('censusRDS is undefined');

      const { plotCensusNumber, censusID, startDate, endDate, description, isActive } = censusRDS;
      // Only carry the window/measurement fields when the row actually has them, so a
      // payload from an older list keeps its original shape.
      const extraDates: Partial<CensusDateRange> = {};
      for (const key of ['censusStartDate', 'censusEndDate', 'firstMeasurementDate', 'lastMeasurementDate'] as const) {
        if (censusRDS[key] !== undefined) extraDates[key] = censusRDS[key];
      }
      let existingCensus = uniqueCensusMap.get(plotCensusNumber!);

      if (!existingCensus) {
        existingCensus = {
          plotID: censusRDS.plotID!,
          plotCensusNumber: plotCensusNumber!,
          censusIDs: [censusID!],
          dateRanges: [{ censusID: censusID!, startDate, endDate, ...extraDates }],
          description: description || '',
          isActive: bitToBoolean(isActive)
        };
        uniqueCensusMap.set(plotCensusNumber!, existingCensus);
      } else {
        existingCensus.censusIDs.push(censusID!);
        existingCensus.dateRanges.push({ censusID: censusID!, startDate, endDate, ...extraDates });
        existingCensus.dateRanges.sort((a, b) => b.censusID - a.censusID);
        existingCensus.isActive = existingCensus.isActive || bitToBoolean(isActive);
      }
    });

    return Array.from(uniqueCensusMap.values()).sort((a, b) => b.plotCensusNumber - a.plotCensusNumber);
  }

  async startNewCensus(
    schema: string,
    plotID: number,
    plotCensusNumber: number,
    details?: { description?: string; startDate?: string; endDate?: string }
  ): Promise<number | undefined> {
    // census.StartDate / EndDate are MySQL DATE columns. Keep the browser's date-only
    // values intact so the insert survives strict sql_mode without a Date/timezone
    // round-trip that could change the selected calendar day.
    const newRow = {
      censusID: 0, // This will be replaced with the actual ID after the POST request
      plotID,
      plotCensusNumber,
      startDate: details?.startDate,
      endDate: details?.endDate,
      description: details?.description
    };

    const response = await fetch(`/api/fixeddata/census/${schema}/censusID`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newRow })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Census creation failed (HTTP ${response.status}): ${errorBody}`);
    }

    const responseJSON = await response.json();
    return responseJSON.createdIDs?.census;
  }
}

/**
 * Body for PATCH /api/fixeddata/census/<schema>/censusID. Both dates are always sent as
 * 'YYYY-MM-DD' strings: the PATCH handler rewrites every column of the persisted row, and a
 * persisted DATE it re-serialises from a Date object is rendered in the server's local zone.
 */
export function buildCensusDatesPatchBody(censusID: number, dates: CensusDates) {
  return {
    oldRow: { censusID },
    newRow: { censusID, startDate: dates.startDate, endDate: dates.endDate }
  };
}

export function reconcileCurrentCensusSelection(currentCensus: OrgCensus, censusList: OrgCensusRDS[]): OrgCensusRDS | undefined {
  if (!currentCensus) return undefined;

  const persistedCensusID = currentCensus.dateRanges?.[0]?.censusID;
  if (persistedCensusID) {
    const exactMatch = censusList.find(census => census.dateRanges?.some(dateRange => dateRange.censusID === persistedCensusID));
    if (exactMatch) return exactMatch;
  }

  return censusList.find(census => census.plotCensusNumber === currentCensus.plotCensusNumber);
}

// Helper function
export async function createAndUpdateCensusList(censusRDSLoad: CensusRDS[]): Promise<OrgCensusRDS[]> {
  const orgCensusMapper = new OrgCensusToCensusResultMapper();

  const censusResultList: CensusResult[] = MapperFactory.getMapper<CensusRDS, CensusResult>('census').demapData(
    censusRDSLoad.filter(data => data !== undefined)
  );
  return orgCensusMapper.demapData(censusResultList);
}
